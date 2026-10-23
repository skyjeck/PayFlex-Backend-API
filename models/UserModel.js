import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    otherName: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["user", "admin", "super_admin"],
      default: "user",
    },
    profileImage: { type: String, default: "" },
    
    // Auth & Verification
    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },

    // Transaction Security
    transactionPin: {
      type: String,
      default: null,
      select: false,
    },

    // KYC Tier System
    kycTier: {
      type: Number,
      default: 1,
    },
    kycStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    kycDetails: {
      bvn: { type: String, default: null },
      nin: { type: String, default: null },
      documentType: { type: String, default: null },
      documentNumber: { type: String, default: null },
      documentImage: { type: String, default: null },
      submittedAt: { type: Date, default: null },
    },

    // Password Reset & Notes
    resetPasswordOTP: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    kycRejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

// Verify account password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Hash and set PIN
userSchema.methods.setTransactionPin = async function (rawPin) {
  const salt = await bcrypt.genSalt(10);
  this.transactionPin = await bcrypt.hash(String(rawPin), salt);
};

// Verify PIN
userSchema.methods.comparePin = async function (candidatePin) {
  if (!this.transactionPin) return false;
  return await bcrypt.compare(String(candidatePin), this.transactionPin);
};

const userModel = mongoose.models.User || mongoose.model("User", userSchema);
export default userModel;