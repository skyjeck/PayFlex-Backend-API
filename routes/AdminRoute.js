import express from "express";
import { reviewKYC } from "../controllers/AdminController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { adminMiddleware } from "../middlewares/adminMiddleware.js";

const adminRouter = express.Router();

adminRouter.post("/kyc/review", authMiddleware, adminMiddleware, reviewKYC);

export default adminRouter;