import mongoose from "mongoose";

// Sub-schema for individual installments
const amortizationItemSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  principalAmount: { type: Number, required: true },
  interestAmount: { type: Number, required: true },
  totalEMI: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "paid", "partially_paid"],
    default: "pending",
  },
  amountPaid: { type: Number, default: 0 },
  penaltyAmount: { type: Number, default: 0 },
});

const loanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    approvedLimit: { type: Number },
    creditCheckRef: { type: String },
    creditScoreAtApplication: { type: Number },

    interestRate: {
      type: Number,
      default: 12, // 12% per annum
    },
    tenureMonths: {
      type: Number,
      required: true,
    },
    monthlyEMI: {
      type: Number,
      required: true,
    },
    totalRepayment: {
      type: Number,
      required: true,
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    remainingBalance: {
      type: Number,
      required: true,
    },
    purpose: {
      type: String,
      default: "Personal Loan",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "disbursed", "rejected", "completed"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    disbursedAt: {
      type: Date,
    },
    nextDueDate: {
      type: Date,
    },
    lastPaymentDate: {
      type: Date,
    },

    // 🌟 Early Settlement Controls
    allowEarlySettlement: {
      type: Boolean,
      default: true,
    },
    earlySettlementFeePercentage: {
      type: Number,
      default: 2.0, // 2% admin fee on remaining principal
    },
    latePenaltyPercentage: {
      type: Number,
      default: 5.0, // 5% flat penalty on overdue EMI
    },

    // Array storing month-by-month repayment breakdown
    amortizationSchedule: [amortizationItemSchema],
  },
  {
    timestamps: true,
  }
);

const Loan = mongoose.models.Loan || mongoose.model("Loan", loanSchema);

export default Loan;