import mongoose from "mongoose";
import userModel from "../models/UserModel.js";
import Loan from "../models/LoanModel.js";
import Wallet from "../models/WalletModel.js";
import Transaction from "../models/TransactionModel.js";
import { createNotification } from "./NotificationController.js";

// GET /api/admin/kyc - Get users based on KYC status
// Access: Private (admin, super_admin)
export const getKYCApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = {};
    const allowedStatuses = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"];
    if (status && allowedStatuses.includes(status.toUpperCase())) {
      filter.kycStatus = status.toUpperCase();
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      userModel.find(filter)
        .select("firstName lastName email phone kycTier kycStatus kycDetails kycRejectionReason createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      userModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        limit: Number(limit),
      },
      users,
    });
  } catch (error) {
    console.error("Admin Get KYC Error:", error);
    return res.status(500).json({ success: false, message: "Error fetching KYC applications." });
  }
};
// POST /api/admin/kyc/review - Approve or Reject Pending Tier 3 KYC
// Access: Private (admin, super_admin)
export const reviewKYC = async (req, res) => {
  try {
    const { targetUserId, action, rejectionReason } = req.body;

    if (!targetUserId || !action) {
      return res.status(400).json({
        success: false,
        message: "Target User ID and action (APPROVE or REJECT) are required.",
      });
    }

    if (!["APPROVE", "REJECT"].includes(action.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed values are 'APPROVE' or 'REJECT'.",
      });
    }

    const user = await userModel.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.kycStatus !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `User KYC is not pending review. Current status: ${user.kycStatus}`,
      });
    }

    // Process Approval
    if (action.toUpperCase() === "APPROVE") {
      user.kycTier = 3;
      user.kycStatus = "VERIFIED";
      user.kycRejectionReason = null;
      await user.save();

      await createNotification(
        user._id,
        "KYC Approved",
        "Congratulations! Your Tier 3 KYC application has been approved.",
        "SYSTEM"
      );

      return res.status(200).json({
        success: true,
        message: "Tier 3 KYC approved successfully!",
        user: {
          id: user._id,
          email: user.email,
          kycTier: user.kycTier,
          kycStatus: user.kycStatus,
        },
      });
    }

    // Process Rejection
    if (action.toUpperCase() === "REJECT") {
      if (!rejectionReason) {
        return res.status(400).json({
          success: false,
          message: "A rejection reason is required when rejecting KYC.",
        });
      }

      user.kycStatus = "REJECTED";
      user.kycRejectionReason = rejectionReason;
      await user.save();

      await createNotification(
        user._id,
        "KYC Rejected",
        `Your Tier 3 KYC application was rejected. Reason: ${rejectionReason}`,
        "SYSTEM"
      );

      return res.status(200).json({
        success: true,
        message: "Tier 3 KYC request rejected.",
        user: {
          id: user._id,
          email: user.email,
          kycStatus: user.kycStatus,
          rejectionReason: user.kycRejectionReason,
        },
      });
    }
  } catch (error) {
    console.error("KYC Review Error:", error);
    res.status(500).json({ success: false, message: "Error processing KYC review." });
  }
};

// ─────────────────────────────────────────────
// LOAN ADMINISTRATION
// ─────────────────────────────────────────────

/**
 * GET /api/admin/loans
 * Query params: ?status=pending|approved|disbursed|rejected|completed&page=1&limit=10
 * Access: Private (admin, super_admin)
 */
export const getAllLoanApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = {};
    const allowedStatuses = ["pending", "approved", "disbursed", "rejected", "completed"];
    if (status && allowedStatuses.includes(status.toLowerCase())) {
      filter.status = status.toLowerCase();
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [loans, total] = await Promise.all([
      Loan.find(filter)
        .populate("userId", "firstName lastName email phone kycTier")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Loan.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        limit: Number(limit),
      },
      loans,
    });
  } catch (error) {
    console.error("Admin Get Loans Error:", error);
    return res.status(500).json({ success: false, message: "Error fetching loan applications." });
  }
};

/**
 * POST /api/admin/loans/:loanId/review
 * Body: { action: "APPROVE" | "REJECT", rejectionReason?: string }
 * Access: Private (admin, super_admin)
 */
export const reviewLoanApplication = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { action, rejectionReason } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: "Action is required. Allowed values: 'APPROVE' or 'REJECT'.",
      });
    }

    const normalizedAction = action.toUpperCase();
    if (!["APPROVE", "REJECT"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed values are 'APPROVE' or 'REJECT'.",
      });
    }

    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan application not found." });
    }

    if (loan.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Loan is not pending review. Current status: '${loan.status}'.`,
      });
    }

    // ── APPROVE ──
    if (normalizedAction === "APPROVE") {
      loan.status = "approved";
      await loan.save();

      await createNotification(
        loan.userId,
        "Loan Approved",
        `Your loan application of ₦${loan.amount.toLocaleString()} has been approved! It will be disbursed to your wallet shortly.`,
        "SYSTEM"
      );

      return res.status(200).json({
        success: true,
        message: "Loan application approved successfully.",
        loan: {
          id: loan._id,
          userId: loan.userId,
          amount: loan.amount,
          status: loan.status,
          monthlyEMI: loan.monthlyEMI,
          tenureMonths: loan.tenureMonths,
        },
      });
    }

    // ── REJECT ──
    if (normalizedAction === "REJECT") {
      if (!rejectionReason) {
        return res.status(400).json({
          success: false,
          message: "A rejection reason is required when rejecting a loan application.",
        });
      }

      loan.status = "rejected";
      loan.rejectionReason = rejectionReason;
      await loan.save();

      await createNotification(
        loan.userId,
        "Loan Application Rejected",
        `Your loan application of ₦${loan.amount.toLocaleString()} was not approved. Reason: ${rejectionReason}`,
        "SYSTEM"
      );

      return res.status(200).json({
        success: true,
        message: "Loan application rejected.",
        loan: {
          id: loan._id,
          userId: loan.userId,
          amount: loan.amount,
          status: loan.status,
          rejectionReason,
        },
      });
    }
  } catch (error) {
    console.error("Admin Review Loan Error:", error);
    return res.status(500).json({ success: false, message: "Error processing loan review." });
  }
};

/**
 * PATCH /api/admin/loans/:loanId/approve-disburse
 * Access: Private (admin, super_admin)
 */
export const approveAndDisburseLoan = async (req, res) => {
  // Safely detect if the database topology supports replica set transactions
  const topologyType =
    mongoose.connection.client?.topology?.s?.description?.type ||
    mongoose.connection.client?.topology?.description?.type;
  const isReplicaSet =
    topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";

  let session = null;
  if (isReplicaSet) {
    session = await mongoose.startSession();
    session.startTransaction();
  }
  const options = session ? { session } : {};

  try {
    const { loanId } = req.params;

    const loan = await Loan.findById(loanId, null, options);
    if (!loan) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Loan application not found." });
    }

    if (loan.status !== "pending" && loan.status !== "approved") {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Loan cannot be disbursed. Current status: '${loan.status}'.`,
      });
    }

    // Verify associated user exists
    const user = await userModel.findById(loan.userId, null, options);
    if (!user) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Associated user not found." });
    }

    // Find the user's wallet
    const wallet = await Wallet.findOne(
      { $or: [{ userId: loan.userId }, { user: loan.userId }] },
      null,
      options
    );
    if (!wallet) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User wallet not found. Cannot disburse loan.",
      });
    }

    // Update loan status to disbursed
    loan.status = "disbursed";
    loan.disbursedAt = new Date();
    await loan.save(options);

    // Credit the disbursed amount to the user's wallet
    wallet.availableBalance = Number(
      ((wallet.availableBalance || 0) + loan.amount).toFixed(2)
    );
    wallet.ledgerBalance = Number(
      ((wallet.ledgerBalance || 0) + loan.amount).toFixed(2)
    );
    await wallet.save(options);

    // Create a LOAN_DISBURSEMENT transaction record for audit trail
    const reference = `LN-DISB-${loan._id}-${Date.now()}`;
    await Transaction.create(
      [
        {
          userId: loan.userId,
          amount: loan.amount,
          type: "LOAN_DISBURSEMENT",
          status: "SUCCESS",
          reference,
          narration: `Loan disbursement for Loan ID: ${loan._id}`,
        },
      ],
      options
    );

    if (session) await session.commitTransaction();

    // Send in-app notification
    await createNotification(
      user._id,
      "Loan Disbursed",
      `Your loan of ₦${loan.amount.toLocaleString()} has been approved and credited to your wallet!`,
      "SYSTEM"
    );

    return res.status(200).json({
      success: true,
      message: "Loan approved and funds disbursed successfully.",
      loan,
      disbursedAmount: loan.amount,
      newWalletBalance: wallet.availableBalance,
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error("Approve & Disburse Error:", error);
    return res.status(500).json({ success: false, message: "Error approving and disbursing loan." });
  } finally {
    if (session) session.endSession();
  }
};

/**
 * PATCH /api/admin/loans/:loanId/reject
 * Access: Private (admin, super_admin)
 */
export const rejectLoanApplication = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason is required when rejecting a loan application.",
      });
    }

    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ success: false, message: "Loan application not found." });
    }

    if (loan.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Loan cannot be rejected. Current status: '${loan.status}'.`,
      });
    }

    loan.status = "rejected";
    loan.rejectionReason = rejectionReason;
    await loan.save();

    await createNotification(
      loan.userId,
      "Loan Application Rejected",
      `Your loan application of ₦${loan.amount.toLocaleString()} was rejected. Reason: ${rejectionReason}`,
      "SYSTEM"
    );

    return res.status(200).json({
      success: true,
      message: "Loan application rejected successfully.",
      loan,
    });
  } catch (error) {
    console.error("Reject Loan Error:", error);
    return res.status(500).json({ success: false, message: "Error rejecting loan application." });
  }
};