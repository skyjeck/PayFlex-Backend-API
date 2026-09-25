import express from "express";
import { getUnifiedHistory, getReceiptByReference } from "../controllers/HistoryController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const historyRouter = express.Router();

historyRouter.get("/", authMiddleware, getUnifiedHistory);

// Unified receipt lookup for Share Receipt — works for all transaction types
historyRouter.get("/receipt/:reference", authMiddleware, getReceiptByReference);

export default historyRouter;
