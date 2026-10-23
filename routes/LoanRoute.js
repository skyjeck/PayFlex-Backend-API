import express from "express";
import {
  applyForLoan,
  repayEMI,
  getUnifiedHistory,
  getLoanDetails,
  getReceiptByReference,
  getUserLoans,
} from "../controllers/LoanController.js";
import {
  triggerLoanNotificationJob,
  sendAdHocLoanNotification,
  previewLoanNotification,
} from "../controllers/LoanNotificationController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const LoanRouter = express.Router();

// Apply auth middleware to all loan routes
LoanRouter.use(authMiddleware);

// ---------------------------------------------------------------------------
// 1. Unified History & Receipts
// ---------------------------------------------------------------------------

// GET /api/loan/ - Fetch paginated transaction history
LoanRouter.get("/", getUnifiedHistory);

// GET /api/loan/receipt/:reference - Fetch specific receipt data
LoanRouter.get("/receipt/:reference", getReceiptByReference);

// ---------------------------------------------------------------------------
// 2. Loan Management & Applications
// ---------------------------------------------------------------------------

// POST /api/loan/apply - Submit loan application (user)
LoanRouter.post("/apply", applyForLoan);

// GET /api/loan/my-loans - Fetch user's active & past loans
LoanRouter.get("/my-loans", getUserLoans);

// POST /api/loan/repay - Deduct EMI payment from wallet
LoanRouter.post("/repay", repayEMI);

// ---------------------------------------------------------------------------
// 3. Loan Push Notification Endpoints
// ---------------------------------------------------------------------------

// POST /api/loan/notifications/run-job - Admin: manually trigger full notification scan
LoanRouter.post("/notifications/run-job", triggerLoanNotificationJob);

// POST /api/loan/notifications/send-user - Admin: send ad-hoc notification to a specific user
LoanRouter.post("/notifications/send-user", sendAdHocLoanNotification);

// GET /api/loan/notifications/preview/:loanId - User: dry-run preview of next notification
LoanRouter.get("/notifications/preview/:loanId", previewLoanNotification);

// GET /api/loan/:loanId - Fetch details for a specific loan (kept last to avoid route conflicts)
LoanRouter.get("/:loanId", getLoanDetails);

export default LoanRouter;