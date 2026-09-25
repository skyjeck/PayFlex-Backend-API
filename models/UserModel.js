import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    otherName: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    password: { type: String, required: true, select: false },
    profileImage: { type: String, default: "" },
    
    // Auth & Verification
    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },

    // Transaction Security (default: null allows registration without PIN)
    transactionPin: {
      type: String,
      default: null,
      select: false, // Prevents exposing PIN hash in default queries
    },

    // KYC Tier System
    kycTier: {
      type: Number,
      default: 1, // Tier 1 (Email/Phone), Tier 2 (BVN/NIN), Tier 3 (Utility/ID Document)
    },
    kycStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    kycDetails: {
      bvn: { type: String, default: null },
      nin: { type: String, default: null },
      documentType: { type: String, default: null }, // 'PASSPORT', 'DRIVERS_LICENSE', 'NIN_CARD'
      documentNumber: { type: String, default: null },
      submittedAt: { type: Date, default: null },
    },

    // Password Reset Fields
    resetPasswordOTP: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    kycRejectionReason: { type: String, default: null },
  },
  
  { timestamps: true }
);

// Method to hash and set PIN
userSchema.methods.setTransactionPin = async function (rawPin) {
  const salt = await bcrypt.genSalt(10);
  this.transactionPin = await bcrypt.hash(String(rawPin), salt);
};

// Method to verify candidate PIN during transfers/swaps
userSchema.methods.comparePin = async function (candidatePin) {
  if (!this.transactionPin) return false;
  return await bcrypt.compare(String(candidatePin), this.transactionPin);
};

const userModel = mongoose.models.user || mongoose.model("user", userSchema);
export default userModel;