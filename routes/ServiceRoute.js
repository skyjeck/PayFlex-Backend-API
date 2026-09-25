import express from "express";
import { getAirtimeProviders, purchaseAirtime, getDataPlans, getAllCable, purchaseData, verifyCustomer, getCablePackages, purchaseCableTV, purchaseElectricity, getServiceHistory, getServiceByReference, getBettingProviders, verifyBettingCustomer, fundBettingWallet, verifySmartcard, getElectricityProviders, verifyMeter } from "../controllers/ServiceController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const serviceRouter = express.Router();

// Airtime Routes
serviceRouter.get("/airtime/providers", authMiddleware, getAirtimeProviders);
serviceRouter.post("/airtime/purchase", authMiddleware, purchaseAirtime);

// Data Routes
serviceRouter.post("/data/plans", authMiddleware, getDataPlans);
serviceRouter.post("/data/purchase", authMiddleware, purchaseData);

// Verification & Cable & Electricity
serviceRouter.get('/electricity/all', authMiddleware, getElectricityProviders);
serviceRouter.post("/verify-customer", authMiddleware, verifyCustomer);
serviceRouter.post("/cable/packages", getCablePackages);
serviceRouter.post("/cable/purchase", authMiddleware, purchaseCableTV);
serviceRouter.post("/electricity/purchase", authMiddleware, purchaseElectricity);

serviceRouter.get("/cables/all", authMiddleware, getAllCable);
serviceRouter.post("/cables/verify-smartcard", authMiddleware, verifySmartcard);
serviceRouter.post("/verify-meter", authMiddleware, verifyMeter);
// GET /api/v1/services/history
serviceRouter.get("/history", authMiddleware, getServiceHistory);

// GET /api/v1/services/transaction/:reference
serviceRouter.get("/transaction/:reference", authMiddleware, getServiceByReference);

// Betting Routes
serviceRouter.get("/betting/providers", getBettingProviders);
serviceRouter.post("/betting/verify", authMiddleware, verifyBettingCustomer);
serviceRouter.post("/betting/fund", authMiddleware, fundBettingWallet);

export default serviceRouter;