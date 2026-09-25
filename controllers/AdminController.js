


import userModel from "../models/UserModel.js";
import { createNotification } from "./NotificationController.js";

// POST /admin/kyc/review - Approve or Reject Pending Tier 3 KYC
export const reviewKYC = async (req, res) => {
  try {
    const { targetUserId, action, rejectionReason } = req.body;

    // Validate inputs
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