import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["INFO", "TRANSACTION", "SYSTEM", "PROMO", "SECURITY"],
      default: "INFO",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    data: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

const notificationModel = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
export default notificationModel;
