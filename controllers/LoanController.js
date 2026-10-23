import mongoose from "mongoose";
import Loan from "../models/LoanModel.js";
import Wallet from "../models/WalletModel.js";
import Transaction from "../models/TransactionModel.js";
import { performCreditCheck } from "./PerformCreditCheck.js";
import { calculateEarlySettlement, calculateLatePenalties } from "../utils/loanCalculation.js";


// Helper: Safely resolve User ID across different auth middleware formats
const getAuthUserId = (req) => req.userId || req.user?._id || req.user?.id;

// Helper: Calculate Amortization Schedule
const buildAmortization = (principal, annualRate, tenureMonths, startDate = new Date()) => {
  const monthlyRate = annualRate / 100 / 12;
  const emi = monthlyRate > 0
    ? (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
      (Math.pow(1 + monthlyRate, tenureMonths) - 1)
    : principal / tenureMonths;

  const monthlyEMI = Number(emi.toFixed(2));
  let currentBalance = principal;
  const schedule = [];

  for (let i = 1; i <= tenureMonths; i++) {
    const interestForMonth = Number((currentBalance * monthlyRate).toFixed(2));
    const principalForMonth = Number((monthlyEMI - interestForMonth).toFixed(2));
    currentBalance = Number(Math.max(0, currentBalance - principalForMonth).toFixed(2));

    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      installmentNumber: i,
      dueDate,
      principalAmount: principalForMonth,
      interestAmount: interestForMonth,
      totalEMI: monthlyEMI,
      status: "pending",
      amountPaid: 0,
    });
  }

  return { monthlyEMI, schedule };
};

export const applyForLoan = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Missing user authentication.",
      });
    }

    const { amount, tenureMonths, purpose } = req.body;
    const requestedAmount = Number(amount);
    const tenure = Number(tenureMonths);

    if (!requestedAmount || requestedAmount <= 0 || !tenure || tenure <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid positive loan amount and tenureMonths are required.",
      });
    }

    // Check for active loan or ongoing payment/application
    const existingActiveLoan = await Loan.findOne({
      userId,
      status: { $in: ["pending", "approved", "disbursed"] },
    });

    if (existingActiveLoan) {
      let statusDetail = "an active loan";
      if (existingActiveLoan.status === "disbursed") {
        statusDetail = "an active disbursed loan with ongoing payments";
      } else if (existingActiveLoan.status === "pending") {
        statusDetail = "a pending loan application awaiting review";
      } else if (existingActiveLoan.status === "approved") {
        statusDetail = "an approved loan awaiting disbursement";
      }

      return res.status(400).json({
        success: false,
        message: `You cannot apply for another loan while you have ${statusDetail}. Please complete or settle your current loan first.`,
        activeLoan: {
          id: existingActiveLoan._id,
          status: existingActiveLoan.status,
          amount: existingActiveLoan.amount,
          remainingBalance: existingActiveLoan.remainingBalance,
        },
      });
    }

    // 1. Credit Assessment
    let creditAssessment;
    try {
      creditAssessment = await performCreditCheck(userId);
    } catch (checkError) {
      return res.status(503).json({
        success: false,
        message: checkError.message || "Credit verification service unavailable.",
      });
    }

    if (!creditAssessment.eligible) {
      return res.status(400).json({
        success: false,
        message: creditAssessment.reason || "Credit check failed. Ineligible for a loan.",
        creditScore: creditAssessment.creditScore,
      });
    }

    if (requestedAmount > creditAssessment.maxLimit) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds limit of $${creditAssessment.maxLimit}.`,
        maxAllowedAmount: creditAssessment.maxLimit,
        creditScore: creditAssessment.creditScore,
      });
    }

    // 2. Generate Terms & Amortization Schedule
    const annualInterestRate = 12; // 12% p.a.
    const { monthlyEMI, schedule } = buildAmortization(requestedAmount, annualInterestRate, tenure);
    const totalRepayment = Number((monthlyEMI * tenure).toFixed(2));

    // 3. Save Loan
    const loan = new Loan({
      userId,
      amount: requestedAmount,
      approvedLimit: creditAssessment.maxLimit,
      creditCheckRef: creditAssessment.referenceId,
      creditScoreAtApplication: creditAssessment.creditScore,
      interestRate: annualInterestRate,
      tenureMonths: tenure,
      monthlyEMI,
      totalRepayment,
      remainingBalance: totalRepayment,
      amountPaid: 0,
      purpose: purpose || "Personal Loan",
      status: "pending",
      nextDueDate: schedule[0]?.dueDate, // First installment due date
      amortizationSchedule: schedule,    // Attach pre-generated schedule
    });

    await loan.save();

    return res.status(201).json({
      success: true,
      message: "Loan application submitted successfully.",
      loan,
    });
  } catch (error) {
    console.error("Apply Loan Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const repayEMI = async (req, res) => {
  let session = null;
  
  // Safely detect if the database topology supports replica set transactions
  const topologyType = mongoose.connection.client?.topology?.s?.description?.type 
                    || mongoose.connection.client?.topology?.description?.type;
  const isReplicaSet = topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';

  if (isReplicaSet) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  // Options object helper to ensure we never pass `{ session: null }`
  const options = session ? { session } : {};

  try {
    const userId = getAuthUserId(req);
    const { loanId, customAmount, isEarlySettlement } = req.body;

    // 1. Fetch Loan
    const loan = await Loan.findOne({ _id: loanId, userId, status: "disbursed" }, null, options);
    if (!loan) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Active disbursed loan not found." });
    }

    // 2. Apply Late Penalties (if any)
    const penaltyResult = calculateLatePenalties(loan);
    if (penaltyResult.penaltyApplied) {
      loan.amortizationSchedule = penaltyResult.updatedSchedule;
      loan.remainingBalance = Number((loan.remainingBalance + penaltyResult.totalPenalty).toFixed(2));
      loan.totalRepayment = Number((loan.totalRepayment + penaltyResult.totalPenalty).toFixed(2));
    }

    let paymentRequested;
    let isSettlingEarly = false;

    if (isEarlySettlement && loan.allowEarlySettlement) {
      const earlySettlementDetails = calculateEarlySettlement(loan);
      paymentRequested = earlySettlementDetails.totalPayoffAmount;
      isSettlingEarly = true;
    } else {
      paymentRequested = customAmount ? Number(customAmount) : loan.monthlyEMI;
    }

    const repaymentAmount = Number(Math.min(paymentRequested, loan.remainingBalance).toFixed(2));

    if (repaymentAmount <= 0) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Loan is already fully settled or invalid amount." });
    }

    // 3. Wallet Balance Verification
    const wallet = await Wallet.findOne({ $or: [{ userId }, { user: userId }] }, null, options);
    if (!wallet) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Wallet not found." });
    }

    const currentBalance = Number(wallet.availableBalance ?? wallet.balance ?? 0);
    if (currentBalance < repaymentAmount) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ₦${repaymentAmount}, Available: ₦${currentBalance}`,
      });
    }

    // 3. Deduct Wallet Balance
    if (wallet.availableBalance !== undefined) {
      wallet.availableBalance = Number((wallet.availableBalance - repaymentAmount).toFixed(2));
      if (wallet.ledgerBalance !== undefined) {
        wallet.ledgerBalance = Number((wallet.ledgerBalance - repaymentAmount).toFixed(2));
      }
    } else {
      wallet.balance = Number((wallet.balance - repaymentAmount).toFixed(2));
    }
    await wallet.save(options);

    // 5. Reconcile Schedule Items
    if (isSettlingEarly) {
      // Early settlement marks everything as paid
      loan.amortizationSchedule.forEach(item => {
        if (item.status !== "paid") {
          item.amountPaid = item.totalEMI + (item.penaltyAmount || 0);
          item.status = "paid";
        }
      });
      loan.amountPaid = Number((loan.amountPaid + repaymentAmount).toFixed(2));
      loan.remainingBalance = 0;
      loan.status = "completed";
      loan.nextDueDate = null;
    } else {
      // Normal repayment allocation (penalties first, then EMI)
      let unallocatedFunds = repaymentAmount;

      for (const item of loan.amortizationSchedule) {
        if (unallocatedFunds <= 0) break;
        if (item.status === "paid") continue;

        // Total required for this installment = totalEMI + penaltyAmount
        const totalRequiredForInstallment = Number((item.totalEMI + (item.penaltyAmount || 0)).toFixed(2));
        const remainingForInstallment = Number((totalRequiredForInstallment - item.amountPaid).toFixed(2));

        if (unallocatedFunds >= remainingForInstallment) {
          unallocatedFunds = Number((unallocatedFunds - remainingForInstallment).toFixed(2));
          item.amountPaid = totalRequiredForInstallment;
          item.status = "paid";
        } else {
          item.amountPaid = Number((item.amountPaid + unallocatedFunds).toFixed(2));
          item.status = "partially_paid";
          unallocatedFunds = 0;
        }
      }

      // Update Core Loan Totals & Next Due Date
      loan.amountPaid = Number((loan.amountPaid + repaymentAmount).toFixed(2));
      loan.remainingBalance = Number(Math.max(0, loan.remainingBalance - repaymentAmount).toFixed(2));

      if (loan.remainingBalance <= 0) {
        loan.status = "completed";
        loan.remainingBalance = 0;
        loan.nextDueDate = null;
      } else {
        // Point nextDueDate to the first pending/unpaid schedule item
        const nextPendingItem = loan.amortizationSchedule.find((item) => item.status !== "paid");
        if (nextPendingItem) {
          loan.nextDueDate = nextPendingItem.dueDate;
        }
      }
    }

    // Record last payment date
    loan.lastPaymentDate = new Date();

    await loan.save(options);

    // 6. Record Transaction Ledger Entry (Matched to TransactionModel Schema)
    const reference = `LN-REPAY-${loan._id}-${Date.now()}`;
    await Transaction.create(
      [
        {
          userId,
          amount: repaymentAmount,
          type: "LOAN_REPAYMENT", // Matches type enum
          status: "SUCCESS",       // Matches status enum
          reference,
          narration: isSettlingEarly 
            ? `Early loan settlement for Loan ID: ${loan._id}` 
            : `Loan EMI repayment for Loan ID: ${loan._id}`,
        },
      ],
      options
    );

    if (session) await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: loan.status === "completed" ? "Loan fully settled!" : "EMI payment successful.",
      repaymentAmount,
      remainingBalance: loan.remainingBalance,
      nextDueDate: loan.nextDueDate,
      amortizationSchedule: loan.amortizationSchedule,
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error("Repay EMI Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    if (session) session.endSession();
  }
};

// 1. Get Details for a Specific Loan (Includes Amortization Schedule & Summary)
export const getLoanDetails = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { loanId } = req.params;

    // Fetch the loan and ensure it belongs to the authenticated user
    const loan = await Loan.findOne({ _id: loanId, userId }).lean();
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Loan not found.",
      });
    }

    // Compute progress stats for easy client rendering
    const totalInstallments = loan.amortizationSchedule?.length || 0;
    const paidInstallments = loan.amortizationSchedule?.filter(
      (item) => item.status === "paid"
    ).length || 0;
    
    const progressPercentage = loan.totalRepayment > 0 
      ? Number(((loan.amountPaid / loan.totalRepayment) * 100).toFixed(1))
      : 0;

    return res.status(200).json({
      success: true,
      loan: {
        ...loan,
        summary: {
          progressPercentage,
          totalInstallments,
          paidInstallments,
          remainingInstallments: totalInstallments - paidInstallments,
        },
      },
    });
  } catch (error) {
    console.error("Get Loan Details Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 2. Get Paginated Unified Transaction History (Optionally filtered by Loan)
export const getUnifiedHistory = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { page = 1, limit = 10, category, loanId } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10));
    const limitNumber = Math.max(1, parseInt(limit, 10));
    const skip = (pageNumber - 1) * limitNumber;

    // Build dynamic query
    const query = { userId };
    if (category) {
      query.category = category; // e.g., 'loan_repayment', 'loan_disbursement'
    }
    if (loanId) {
      // Matches references like "LN-REPAY-<loanId>-..." or explicit reference fields
      query.reference = { $regex: loanId, $options: "i" };
    }

    // Execute paginated queries in parallel
    const [transactions, totalRecords] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalRecords / limitNumber);

    return res.status(200).json({
      success: true,
      pagination: {
        totalRecords,
        currentPage: pageNumber,
        totalPages,
        limit: limitNumber,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
      transactions: transactions.map((tx) => ({
        id: tx._id,
        reference: tx.reference,
        amount: tx.amount,
        type: tx.type, // 'credit' or 'debit'
        category: tx.category || "general",
        status: tx.status,
        date: tx.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get Unified History Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getReceiptByReference = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Transaction reference is required.",
      });
    }

    // 1. Fetch transaction record for this user
    const transaction = await Transaction.findOne({ reference, userId }).lean();
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Receipt or transaction not found for this reference.",
      });
    }

    // 2. Extract embedded Loan ID from reference format (e.g., "LN-REPAY-<loanId>-<timestamp>")
    let loanInfo = null;
    const refParts = reference.split("-");
    const potentialLoanId = refParts.find((part) => mongoose.Types.ObjectId.isValid(part));

    if (potentialLoanId) {
      const loan = await Loan.findOne({ _id: potentialLoanId, userId })
        .select("amount purpose status remainingBalance monthlyEMI")
        .lean();

      if (loan) {
        loanInfo = {
          loanId: loan._id,
          purpose: loan.purpose,
          loanStatus: loan.status,
          remainingBalance: loan.remainingBalance,
        };
      }
    }

    // 3. Construct structured digital receipt
    const receipt = {
      receiptNumber: `REC-${transaction.reference}`,
      transactionReference: transaction.reference,
      paymentMethod: transaction.paymentMethod || "Wallet Balance",
      transactionType: transaction.type?.toUpperCase() || "DEBIT",
      category: transaction.category || "loan_repayment",
      amountPaid: transaction.amount,
      currency: "NGN", // ₦
      status: transaction.status?.toUpperCase() || "SUCCESS",
      issuedAt: transaction.createdAt,
      
      // Included if this transaction was tied to a loan
      loanDetails: loanInfo,
      
      // Customer Info
      payerId: userId,
    };

    return res.status(200).json({
      success: true,
      message: "Receipt generated successfully.",
      receipt,
    });
  } catch (error) {
    console.error("Get Receipt Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserLoans = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { status, page = 1, limit = 10 } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10));
    const limitNumber = Math.max(1, parseInt(limit, 10));
    const skip = (pageNumber - 1) * limitNumber;

    // Filter by userId and optional status query param (e.g., ?status=disbursed)
    const filter = { userId };
    if (status) {
      filter.status = status;
    }

    // Run queries in parallel for optimal performance
    const [loans, totalRecords, allUserLoans] = await Promise.all([
      Loan.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Loan.countDocuments(filter),
      // Fetch all loans without pagination to calculate global summary metrics
      Loan.find({ userId }).select("amount remainingBalance status amountPaid totalRepayment").lean(),
    ]);

    // Calculate aggregated portfolio statistics
    const summary = allUserLoans.reduce(
      (acc, loan) => {
        if (loan.status === "disbursed") {
          acc.activeLoans += 1;
          acc.totalActiveBalance += loan.remainingBalance || 0;
        } else if (loan.status === "completed") {
          acc.completedLoans += 1;
        } else if (loan.status === "pending") {
          acc.pendingApplications += 1;
        }
        acc.totalAmountBorrowed += loan.amount || 0;
        acc.totalAmountPaid += loan.amountPaid || 0;
        return acc;
      },
      {
        totalLoansCount: allUserLoans.length,
        activeLoans: 0,
        completedLoans: 0,
        pendingApplications: 0,
        totalAmountBorrowed: Number((0).toFixed(2)),
        totalActiveBalance: Number((0).toFixed(2)),
        totalAmountPaid: Number((0).toFixed(2)),
      }
    );

    // Format individual loan items with progress stats
    const formattedLoans = loans.map((loan) => {
      const totalInstallments = loan.amortizationSchedule?.length || 0;
      const paidInstallments = loan.amortizationSchedule?.filter(
        (item) => item.status === "paid"
      ).length || 0;

      const progressPercentage = loan.totalRepayment > 0
        ? Number(((loan.amountPaid / loan.totalRepayment) * 100).toFixed(1))
        : 0;

      return {
        ...loan,
        progress: {
          percentage: progressPercentage,
          paidInstallments,
          totalInstallments,
          remainingInstallments: totalInstallments - paidInstallments,
        },
      };
    });

    const totalPages = Math.ceil(totalRecords / limitNumber);

    return res.status(200).json({
      success: true,
      summary,
      pagination: {
        totalRecords,
        currentPage: pageNumber,
        totalPages,
        limit: limitNumber,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
      loans: formattedLoans,
    });
  } catch (error) {
    console.error("Get User Loans Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};