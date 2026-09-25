import userModel from "../models/UserModel.js";
import walletModel from "../models/WalletModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createNotification } from "./NotificationController.js";
import validator from "validator";
import nodemailer from "nodemailer";
import "../config/cloudinary.js";
import crypto from 'node:crypto';
import { sendEmail } from "../utils/sendMail.js";
import axios from 'axios';

// Helper: Create JWT Token
const createToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
};

// Helper: Generate 6-Digit Numeric OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper: Send Email with OTP
const sendOTPEmail = async (email, otp) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: `"PayFlex" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "PayFlex - Account Verification OTP",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #00C853; text-align: center;">PayFlex Account Verification</h2>
        <p>Hello,</p>
        <p>Thank you for registering with PayFlex. Use the OTP code below to complete your account verification:</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; border-radius: 8px; font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #00C853;">
          ${otp}
        </div>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// 1. Register User (Generates and Sends OTP)
export const registerUser = async (req, res) => {
  const { firstName, lastName, otherName, email, password, phone } = req.body;

  try {
    if (!firstName || !lastName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message:
          "First name, last name, email, password, and phone are required",
      });
    }

    if (!validator.isEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Please enter a valid email" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const exists = await userModel.findOne({ email });
    if (exists) {
      if (exists.isVerified) {
        return res
          .status(400)
          .json({
            success: false,
            message: "User with this email already exists",
          });
      } else {
        // If an unverified user exists from a previous failed attempt, delete it so new attempt can proceed
        await userModel.findByIdAndDelete(exists._id);
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate 6-Digit OTP and set 10-minute expiry time
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const newUser = new userModel({
      firstName,
      lastName,
      otherName: otherName || "",
      email,
      phone,
      password: hashedPassword,
      otpCode: otp,
      otpExpiresAt: otpExpiresAt,
      isVerified: false,
    });

    const user = await newUser.save();

    // Send OTP to User's Email with DB Rollback if email fails
    try {
      await sendOTPEmail(user.email, otp);
    } catch (emailError) {
      console.error("OTP Email Delivery Error:", emailError);
      // Rollback database record so half-registered user is not left in DB
      await userModel.findByIdAndDelete(user._id);
      return res.status(500).json({
        success: false,
        message: `Failed to send verification email (${emailError.message}). Registration aborted.`,
      });
    }

    res.status(201).json({
      success: true,
      userId: user._id,
      email: user.email,
      message: "Account created! Verification OTP sent to your email.",
    });
  } catch (error) {
    console.error("Register Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: error.message || "Error registering user",
      });
  }
};

// 2. Verify OTP Endpoint
export const verifyOTP = async (req, res) => {
  const { userId, otp } = req.body;

  try {
    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required.",
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (user.isVerified) {
      return res
        .status(400)
        .json({ success: false, message: "Account is already verified." });
    }

    if (user.otpCode !== otp) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP code." });
    }

    if (new Date() > new Date(user.otpExpiresAt)) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    // Mark user as verified and clear OTP fields
    user.isVerified = true;
    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = createToken(user._id);

    await createNotification(
      user._id,
      "Welcome to PayFlex!",
      "Your account has been successfully verified. You can now start using all our services.",
      "INFO"
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      message: "Account verified successfully!",
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ success: false, message: "Error verifying OTP" });
  }
};

// 3. Resend OTP Endpoint
export const resendOTP = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (user.isVerified) {
      return res
        .status(400)
        .json({ success: false, message: "Account is already verified." });
    }

    const newOtp = generateOTP();
    user.otpCode = newOtp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    try {
      await sendOTPEmail(user.email, newOtp);
    } catch (emailError) {
      console.error("Resend OTP Email Error:", emailError);
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP email: ${emailError.message}`,
      });
    }

    res.status(200).json({
      success: true,
      message: "A new OTP has been sent to your email.",
    });
  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({ success: false, message: "Error resending OTP" });
  }
};

// 4. Login User
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Explicitly include +password since select: false is set in UserModel.js
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userModel
      .findOne({ email: normalizedEmail })
      .select("+password");

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "User does not exist" });
    }

    // Verify raw input string against the retrieved password hash
    const isMatch = await bcrypt.compare(String(password), user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        userId: user._id,
        message:
          "Account is not verified. Please verify your email using OTP first.",
      });
    }

    const token = createToken(user._id);

    await createNotification(
      user._id,
      "New Login Detected",
      "A new login was detected on your account. If this wasn't you, please change your password immediately.",
      "SECURITY"
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      message: "Logged in successfully!",
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error authenticating user",
      error: error.message,
    });
  }
};

// Fetch Current Profile, Verification Tier, and Balance Summary
export const getProfile = async (req, res) => {
  try {
    // req.user or req.userId is expected to be populated by your JWT middleware
    const userId = req.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access. User ID missing.",
      });
    }

    const user = await userModel
      .findById(userId)
      .select("-password -otpCode -otpExpiresAt");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
    }

    // Determine Verification Tier based on user flags and kycStatus
    let verificationTier = "Tier 0 (Unverified)";
    if (user.isVerified) {
      verificationTier =
        user.kycStatus === "verified" || user.kycVerified
          ? "Tier 2 (Fully Verified)"
          : "Tier 1 (Email Verified)";
    }

    // Fetch the NGN wallet to provide a balance summary
    const defaultWallet = await walletModel.findOne({ userId, currency: "NGN" });

    // Prepare response data
    res.status(200).json({
      success: true,
      profile: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        otherName: user.otherName,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage || "", // <-- ADDED: Cloudinary URL
        profileImagePublicId: user.profileImagePublicId || "", // Optional Cloudinary reference
        isVerified: user.isVerified,
        kycStatus: user.kycStatus || "unsubmitted",
        kycVerified: user.kycVerified || false,
        createdAt: user.createdAt,
      },
      verificationTier,
      balanceSummary: {
        currency: "NGN",
        availableBalance: defaultWallet ? defaultWallet.availableBalance : 0.0,
        ledgerBalance: defaultWallet ? defaultWallet.ledgerBalance : 0.0,
      },
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user profile.",
    });
  }
};

// update user profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { firstName, lastName, otherName, phone } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access.",
      });
    }

    // Build update object dynamically with provided fields only
    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (otherName !== undefined) updateData.otherName = otherName.trim();

    if (phone !== undefined) {
      const trimmedPhone = phone.trim();
      // Check if phone number is already registered to another user
      const phoneExists = await userModel.findOne({
        phone: trimmedPhone,
        _id: { $ne: userId },
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "Phone number is already in use by another account.",
        });
      }
      updateData.phone = trimmedPhone;
    }

    // Process profile image upload if file is attached (Multer memoryStorage or diskStorage)
    if (req.file) {
      // If memoryStorage is used in Multer (req.file.buffer)
      if (req.file.buffer) {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "profile_pictures" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          );
          stream.end(req.file.buffer);
        });
        updateData.profileImage = uploadResult.secure_url;
      }
      // If diskStorage or Multer-Cloudinary storage is used (req.file.path)
      else if (req.file.path) {
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: "profile_pictures",
        });
        updateData.profileImage = uploadResult.secure_url;
      }
    }

    // Ensure at least one field or file is provided for update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields or image provided for update.",
      });
    }

    // Update user document and return updated fields
    const updatedUser = await userModel
      .findByIdAndUpdate(
        userId,
        { $set: updateData },
        { returnDocument: "after", runValidators: true },
      )
      .select("-password -otpCode -otpExpiresAt");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully!",
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        otherName: updatedUser.otherName,
        email: updatedUser.email,
        phone: updatedUser.phone,
        profileImage: updatedUser.profileImage,
        isVerified: updatedUser.isVerified,
      },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating profile details.",
    });
  }
};

// POST /kyc/submit - Submit KYC Verification Details
export const submitKYC = async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;
    let { bvn, nin, documentType, documentNumber, targetTier } = req.body;

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        success: false,
        message:
          "Please verify your email (Tier 1) before submitting KYC details.",
      });
    }

    // Initialize kycDetails object if non-existent
    if (!user.kycDetails) {
      user.kycDetails = {};
    }

    const tierRequested = Number(targetTier);

    // Normalize field mapping if passed via documentNumber for Tier 2
    if (documentType === "BVN" && !bvn && documentNumber) {
      bvn = documentNumber;
    }
    if (documentType === "NIN_CARD" && !nin && documentNumber) {
      nin = documentNumber;
    }

    // --- TIER 2 UPGRADE REQUEST ---
    if (tierRequested === 2) {
      if (!bvn && !nin) {
        return res.status(400).json({
          success: false,
          message: "BVN or NIN is required for Tier 2 verification.",
        });
      }

      if (bvn && bvn.length !== 11) {
        return res
          .status(400)
          .json({ success: false, message: "BVN must be 11 digits." });
      }

      if (nin && nin.length !== 11) {
        return res
          .status(400)
          .json({ success: false, message: "NIN must be 11 digits." });
      }

      user.kycDetails.bvn = bvn || user.kycDetails.bvn;
      user.kycDetails.nin = nin || user.kycDetails.nin;
      user.kycDetails.documentType = documentType || "NIN_CARD";
      user.kycDetails.documentNumber = documentNumber || nin || bvn;

      user.kycTier = 2;
      user.kycVerified = true;
      user.kycStatus = "VERIFIED"; // Lowercase to align with Flutter checks
      user.kycDetails.submittedAt = new Date();

      await user.save();

      await createNotification(
        user._id,
        "KYC Verified",
        "Your Tier 2 KYC details have been verified successfully.",
        "INFO"
      );

      return res.status(200).json({
        success: true,
        message: "Tier 2 KYC verified successfully!",
        kycTier: user.kycTier,
        kycStatus: user.kycStatus,
      });
    }

    // --- TIER 3 UPGRADE REQUEST ---
    if (tierRequested === 3) {
      if (user.kycTier < 2) {
        return res.status(400).json({
          success: false,
          message:
            "You must complete Tier 2 verification before upgrading to Tier 3.",
        });
      }

      if (!documentType) {
        return res.status(400).json({
          success: false,
          message: "Document type is required for Tier 3 verification.",
        });
      }

      // Require documentNumber ONLY if documentType is not NIN_CARD (e.g., PASSPORT)
      if (documentType !== "NIN_CARD" && !documentNumber) {
        return res.status(400).json({
          success: false,
          message: "Document number is required for passport or non-NIN document uploads.",
        });
      }

      // Check if document file was uploaded via Multer / Cloudinary / S3
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "An image file of your document is required for Tier 3 verification.",
        });
      }

      const documentImageUrl = req.file.path || req.file.location || req.file.filename;

      user.kycDetails.documentType = documentType;
      // Use existing NIN if documentType is NIN_CARD, otherwise use passed documentNumber
      user.kycDetails.documentNumber =
        documentType === "NIN_CARD"
          ? user.kycDetails.nin || null
          : documentNumber;
      user.kycDetails.documentImage = documentImageUrl;
      user.kycStatus = "PENDING";
      user.kycDetails.submittedAt = new Date();

      await user.save();

      await createNotification(
        user._id,
        "KYC Submitted",
        "Your Tier 3 verification details have been submitted and are currently under review.",
        "INFO"
      );

      return res.status(200).json({
        success: true,
        message: "Tier 3 verification submitted and currently under review.",
        kycTier: user.kycTier,
        kycStatus: user.kycStatus,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid target tier specified. Choose Tier 2 or Tier 3.",
    });
  } catch (error) {
    console.error("KYC Submission Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing KYC submission." });
  }
};


// POST /api/v1/auth/set-pin
export const setTransactionPin = async (req, res) => {
  try {
    const userId = req.userId;
    const { pin } = req.body;

    // 1. Enforce string conversion & basic structure check
    const pinStr = pin ? String(pin).trim() : "";

    if (!pinStr || pinStr.length !== 4 || !/^\d{4}$/.test(pinStr)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be exactly 4 numeric digits.",
      });
    }

    // 2. Disallow weak PINs (e.g., 0000, 1234, 1111)
    const weakPins = [
      "0000",
      "1111",
      "2222",
      "3333",
      "4444",
      "5555",
      "6666",
      "7777",
      "8888",
      "9999",
      "1234",
      "4321",
    ];
    if (weakPins.includes(pinStr)) {
      return res.status(400).json({
        success: false,
        message:
          "This PIN is too easy to guess. Choose a stronger combination.",
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // 3. Prevent overwriting existing PIN without confirmation
    if (user.transactionPin) {
      return res.status(400).json({
        success: false,
        message:
          "Transaction PIN is already set. Use change PIN or reset PIN option.",
      });
    }

    // Hash and save using schema helper
    await user.setTransactionPin(pinStr);
    await user.save();

    await createNotification(
      user._id,
      "Transaction PIN Set",
      "Your transaction PIN has been set successfully.",
      "SECURITY"
    );

    return res.status(200).json({
      success: true,
      message: "Transaction PIN set successfully.",
    });
  } catch (error) {
    console.error("Set PIN Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to set PIN." });
  }
};

// 1. POST /api/v1/auth/forgot-password
// Generates a 6-digit OTP and sends it via email
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Please provide an email address." });
    }

    const user = await userModel.findOne({ email: email.toLowerCase().trim() });

    // Return generic success even if user not found to prevent email enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists with that email, a 6-digit reset code has been sent.",
      });
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP before saving to DB for added security
    const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

    // Set OTP and expiration (valid for 10 minutes)
    user.resetPasswordOTP = hashedOTP;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 mins
    await user.save();

    // HTML Email Template
    const emailTemplate = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #0F172A;">
        <h2 style="color: #76C800;">PayFlex Password Reset</h2>
        <p>You requested a password reset. Use the code below to reset your password:</p>
        <div style="background: #F1F8EA; padding: 16px; border-radius: 8px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #538F00; margin: 20px 0;">
          ${otp}
        </div>
        <p>This code will expire in <strong>10 minutes</strong>.</p>
        <p style="color: #64748B; font-size: 12px;">If you did not request this, please ignore this email.</p>
      </div>
    `;

    await sendEmail({
      to: user.email,
      subject: "PayFlex - Your Password Reset OTP",
      html: emailTemplate,
    });

    return res.status(200).json({
      success: true,
      message: "If an account exists with that email, a 6-digit reset code has been sent.",
    });

  } catch (error) {
    console.error("Error in forgotPassword:", error);
    return res.status(500).json({ success: false, message: "Error processing forgot password request." });
  }
};

// 2. POST /api/v1/auth/verify-reset-otp
// Validates the 6-digit OTP before allowing user to type a new password
export const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP code are required." });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOTP = otp.toString().trim();
    const hashedOTP = crypto.createHash("sha256").update(cleanOTP).digest("hex");

    // 1. Fetch user by email only
    const user = await userModel.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid OTP code." });
    }

    // 2. Log database state vs input
    console.log("--- OTP DEBUG LOGS ---");
    console.log("Input Hashed OTP: ", hashedOTP);
    console.log("DB Saved OTP Hash:", user.resetPasswordOTP);
    console.log("DB Expiry Time:   ", user.resetPasswordExpires);
    console.log("Current Server Time:", new Date(Date.now()));
    console.log("Is OTP Expired?:  ", user.resetPasswordExpires ? user.resetPasswordExpires < Date.now() : "No Expiry Set");
    console.log("----------------------");

    // 3. Perform manual comparison
    if (!user.resetPasswordOTP || user.resetPasswordOTP !== hashedOTP) {
      return res.status(400).json({ success: false, message: "Invalid OTP code." });
    }

    if (!user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP code has expired." });
    }

    return res.status(200).json({
      success: true,
      message: "OTP code verified successfully.",
    });

  } catch (error) {
    console.error("Error in verifyResetOTP:", error);
    return res.status(500).json({ success: false, message: "Error verifying OTP code." });
  }
};

// 3. POST /api/v1/auth/reset-password
// Sets the new password and clears reset fields
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
    }

    const cleanOTP = otp.toString().trim();
    const hashedOTP = crypto.createHash("sha256").update(cleanOTP).digest("hex");

    const user = await userModel.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordOTP: hashedOTP,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP code." });
    }

    // Hash new password and save
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear reset fields
    user.resetPasswordOTP = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful. You can now log in with your new password.",
    });

  } catch (error) {
    console.error("Error in resetPassword:", error);
    return res.status(500).json({ success: false, message: "Error resetting password." });
  }
};
