import express from "express";
import { handlePaystackWebhook } from "../controllers/WebHookController.js";

const webhookRouter = express.Router();

// No JWT middleware needed - public endpoint secured strictly by signature HMAC
webhookRouter.post("/paystack", handlePaystackWebhook);

export default webhookRouter;