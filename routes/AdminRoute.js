import express from "express";
import { getKYCApplications, reviewKYC, getAllLoanApplications, reviewLoanApplication, approveAndDisburseLoan, rejectLoanApplication } from "../controllers/AdminController.js";

import { authMiddleware, adminOnly } from "../middlewares/authMiddleware.js";

const adminRouter = express.Router();

// All admin routes require a valid JWT AND an admin/super_admin role
adminRouter.use(authMiddleware, adminOnly);

adminRouter.get("/kyc", getKYCApplications);
adminRouter.post("/kyc/review", reviewKYC);

// ---------------------------------------------------------------------------
// Loan Administration
// ---------------------------------------------------------------------------

// GET  /api/admin/loans                       - View all loan applications (filter by ?status=pending etc.)
adminRouter.get("/loans", getAllLoanApplications);

// POST /api/admin/loans/:loanId/review        - Approve or reject a pending loan
adminRouter.post("/loans/:loanId/review", reviewLoanApplication);

// Approve & Disburse
adminRouter.patch("/loans/:loanId/approve-disburse", approveAndDisburseLoan);

// Reject Application
adminRouter.patch("/loans/:loanId/reject", rejectLoanApplication);


export default adminRouter;