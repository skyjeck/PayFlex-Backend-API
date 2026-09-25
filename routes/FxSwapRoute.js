import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {executeSwap, getSwapHistory, getQuote, getFxRates} from '../controllers/FxSwapController.js';
import { verifyTransactionPin } from '../middlewares/pinMiddleware.js';

import { transferFunds } from '../controllers/WalletController.js';

const FxSwapRouter = express.Router();

FxSwapRouter.post("/swap", authMiddleware, verifyTransactionPin, executeSwap);
FxSwapRouter.post("/history/:userId", authMiddleware, getSwapHistory);
FxSwapRouter.get("/quote", authMiddleware, getQuote);
FxSwapRouter.get("/rates", authMiddleware, getFxRates);

FxSwapRouter.post("/wallet/transfer", authMiddleware, verifyTransactionPin, transferFunds);

export default FxSwapRouter;