import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["TRANSFER", "FUNDING", "WITHDRAWAL", "BILL_PAYMENT"], // 👈 Added BILL_PAYMENT
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    fee: {
      type: Number,
      default: 0.0,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    recipientAccount: { type: String, default: null },
    recipientName: { type: String, default: null },
    bankCode: { type: String, default: null },
    bankName: { type: String, default: null },
    narration: { type: String, default: "Wallet Transfer" },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

const transactionModel =
  mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
export default transactionModel;