import jwt from "jsonwebtoken";

// middleware/adminAuth.js
export const adminMiddleware = async (req, res, next) => {
  // Ensure user is authenticated and possesses admin privilege
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }
  next();
};