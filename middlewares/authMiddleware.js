import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: "No token provided." });
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.userId = decoded.userId || decoded.id;
    req.user = decoded; // Contains id, email, role

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

// Check against role enum from userModel
export const adminOnly = (req, res, next) => {
  const allowedRoles = ["admin", "super_admin"];
  
  if (req.user && allowedRoles.includes(req.user.role)) {
    next();
  } else {
    return res.status(403).json({ success: false, message: "Access denied: Admins only." });
  }
};