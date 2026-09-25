// models/ServiceModel.js
import mongoose from "mongoose";

const serviceTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: String,
      enum: ["AIRTIME", "DATA", "CABLE_TV", "ELECTRICITY"], // Add CABLE_TV and ELECTRICITY here
      required: true,
    },
    provider: {
      type: String,
      required: true,
    },
    recipientPhone: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    planCode: {
      type: String,
      default: null,
    },
    // Electricity-specific fields
    token: {
      type: String,
      default: null, // The prepaid electricity token returned by VTPass
    },
    meterNumber: {
      type: String,
      default: null,
    },
    meterType: {
      type: String,
      default: null, // e.g. "prepaid" | "postpaid"
    },
    customerName: {
      type: String,
      default: null,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ServiceTransaction", serviceTransactionSchema);