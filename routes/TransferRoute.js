import express from "express";
import { transferToWallet, getTransactionHistory, lookupPayflexAccount } from "../controllers/TransferController.js";
import { getSupportedBanks, resolveBankAccount } from "../controllers/BankController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { sendMoney } from "../controllers/BankController.js";
import { verifyTransactionPin } from "../middlewares/pinMiddleware.js";

const transferRouter = express.Router();

transferRouter.post("/wallet", authMiddleware, transferToWallet);
transferRouter.get("/lookup", authMiddleware, lookupPayflexAccount);
transferRouter.get("/history", authMiddleware, getTransactionHistory);

transferRouter.get("/banks", authMiddleware, getSupportedBanks);
transferRouter.post("/bank-lookup", authMiddleware, resolveBankAccount);
transferRouter.post("/send-money", authMiddleware, verifyTransactionPin, sendMoney);

export default transferRouter;