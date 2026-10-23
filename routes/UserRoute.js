import express from "express";
import multer from "multer";
import {
  loginUser,
  registerUser,
  verifyOTP,
  resendOTP,
  getProfile,
  updateProfile,
  submitKYC,
  setTransactionPin,
  forgotPassword,
  verifyResetOTP,
  resetPassword
} from "../controllers/UserController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import "../config/cloudinary.js";
import dotenv from "dotenv";

dotenv.config(); // Must be called at the very top!

export const UserRouter = express.Router();

// Multer memory storage config for Cloudinary buffer streaming (5MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

UserRouter.post("/register", registerUser);
UserRouter.post("/verify-otp", verifyOTP);
UserRouter.post("/resend-otp", resendOTP);
UserRouter.post("/login", loginUser);
UserRouter.post("/forgot-password", forgotPassword);
UserRouter.post("/verify-reset-otp", verifyResetOTP);
UserRouter.post("/reset-password", resetPassword);


UserRouter.get("/profile", authMiddleware, getProfile);

// Attach upload.single("profileImage") middleware for multipart profile updates
UserRouter.put(
  "/update",
  authMiddleware,
  upload.single("profileImage"),
  updateProfile
);

UserRouter.post(
  "/kyc/submit",
  authMiddleware,
  upload.fields([
    { name: "document", maxCount: 1 },
    { name: "documentImage", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  submitKYC
);

UserRouter.post("/set-pin", authMiddleware, setTransactionPin);