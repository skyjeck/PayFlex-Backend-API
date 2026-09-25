import crypto from "crypto";
import mongoose from "mongoose";
import walletModel from "../models/WalletModel.js";
import userModel from "../models/UserModel.js";
import Transaction from "../models/TransactionModel.js";
import { createNotification } from "./NotificationController.js";

const isTransactionSupported = () => {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === "ReplicaSetWithPrimary" || type === "Sharded";
};

export const handlePaystackWebhook = async (req, res) => {
  const useTransaction = isTransactionSupported();
  let session = null;

  if (useTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    // 1. Verify Paystack Signature (HMAC SHA512)
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    const { event, data } = req.body;

    // Process only successful charge events
    if (event === "charge.success") {
      const { reference, amount, customer } = data;
      const amountInNaira = amount / 100; // Paystack sends amounts in kobo (1 NGN = 100 kobo)
      const userEmail = customer.email;

      // 2. Idempotency Check (Prevent duplicate top-ups if Paystack retries webhook)
      const existingTx = useTransaction
        ? await Transaction.findOne({ reference }).session(session)
        : await Transaction.findOne({ reference });

      if (existingTx) {
        if (session) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(200).json({ success: true, message: "Transaction already processed" });
      }

      // 3. Locate User
      const user = useTransaction
        ? await userModel.findOne({ email: userEmail.toLowerCase() }).session(session)
        : await userModel.findOne({ email: userEmail.toLowerCase() });

      if (!user) {
        if (session) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(404).json({ success: false, message: "User not found for transaction" });
      }

      // 4. Find or Create User's NGN Wallet
      let wallet = useTransaction
        ? await walletModel.findOne({ userId: user._id, currency: "NGN" }).session(session)
        : await walletModel.findOne({ userId: user._id, currency: "NGN" });

      if (!wallet) {
        if (useTransaction) {
          const [newWallet] = await walletModel.create(
            [
              {
                userId: user._id,
                currency: "NGN",
                availableBalance: 0,
                ledgerBalance: 0,
              },
            ],
            { session }
          );
          wallet = newWallet;
        } else {
          wallet = await walletModel.create({
            userId: user._id,
            currency: "NGN",
            availableBalance: 0,
            ledgerBalance: 0,
          });
        }
      }

      // 5. Update NGN Wallet Balance
      if (useTransaction) {
        wallet.availableBalance += Number(amountInNaira);
        wallet.ledgerBalance += Number(amountInNaira);
        await wallet.save({ session });

        await Transaction.create(
          [
            {
              userId: user._id,
              type: "CREDIT",
              amount: Number(amountInNaira),
              currency: "NGN",
              reference: reference,
              narration: `Automated Gateway Deposit via Paystack (${reference})`,
              status: "SUCCESS",
            },
          ],
          { session }
        );

        await session.commitTransaction();
        await session.endSession();
      } else {
        await walletModel.findOneAndUpdate(
          { _id: wallet._id },
          { $inc: { availableBalance: Number(amountInNaira), ledgerBalance: Number(amountInNaira) } }
        );

        await Transaction.create({
          userId: user._id,
          type: "CREDIT",
          amount: Number(amountInNaira),
          currency: "NGN",
          reference: reference,
          narration: `Automated Gateway Deposit via Paystack (${reference})`,
          status: "SUCCESS",
        });
      }

      await createNotification(
        user._id,
        "Wallet Funded",
        `Your wallet has been successfully credited with NGN ${amountInNaira} via Paystack.`,
        "TRANSACTION"
      );

      return res.status(200).json({ success: true, message: "Wallet successfully credited" });
    }

    // Acknowledge non-payment events
    if (session) {
      await session.abortTransaction();
      await session.endSession();
    }
    return res.status(200).json({ success: true, message: "Event ignored" });

  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        await session.endSession();
      } catch (sErr) {
        // ignore
      }
    }
    console.error("Webhook Processing Error:", error);
    return res.status(500).json({ success: false, message: "Webhook handler failed", error: error.message });
  }
};