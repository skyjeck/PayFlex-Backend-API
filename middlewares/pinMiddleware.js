import userModel from "../models/UserModel.js";

export const verifyTransactionPin = async (req, res, next) => {
  try {
    const userId = req.userId;
    let { pin } = req.body;

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required.",
      });
    }

    // Convert to string and trim to handle numeric JSON payloads gracefully
    pin = String(pin).trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be exactly 4 numeric digits.",
      });
    }

    // Retrieve user including transactionPin
    const user = await userModel.findById(userId).select("+transactionPin");

    if (!user || !user.transactionPin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is not set up for this account.",
      });
    }

    // Verify PIN using user model method
    const isMatch = await user.comparePin(pin);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect transaction PIN.",
      });
    }

    // Store sanitized string pin back on req.body and proceed
    req.body.pin = pin;
    next();
  } catch (error) {
    console.error("PIN Verification Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during PIN verification.",
    });
  }
};