import express from "express";
import { getWalletBalance, generateVirtualAccount, fundWallet, getUserWallets } from "../controllers/WalletController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const walletRouter = express.Router();

walletRouter.get("/balance", authMiddleware, getWalletBalance);
walletRouter.post("/generate-virtual-account", authMiddleware, generateVirtualAccount);
walletRouter.post("/fund", authMiddleware, fundWallet);
walletRouter.get("/fetch-wallet", authMiddleware, getUserWallets);

export default walletRouter;