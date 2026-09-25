import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,

    },
    availableBalance: {
      type: Number,
      default: 0.0,
    },
    ledgerBalance: {
      type: Number,
      default: 0.0,
    },
    currency: {
      type: String,
      default: "NGN",
    },
    virtualAccount: {
      accountNumber: { type: String, default: null },
      accountName: { type: String, default: null },
      bankName: { type: String, default: null },
      isGenerated: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);
// Ensures a user can have only ONE wallet per currency (e.g., 1 NGN wallet, 1 USD wallet)
walletSchema.index({ userId: 1, currency: 1 }, { unique: true });
const walletModel = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
export default walletModel;