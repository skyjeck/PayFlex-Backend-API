import mongoose from "mongoose";
import walletModel from "../models/WalletModel.js";
import userModel from "../models/UserModel.js";
import Transaction from "../models/TransactionModel.js";
import { createNotification } from "./NotificationController.js";

// Helper: Auto-create wallet if none exists
const getOrCreateWallet = async (userId, currency = "NGN") => {
  let wallet = await walletModel.findOne({ userId, currency });
  if (!wallet) {
    wallet = await walletModel.create({ userId, currency });
  }
  return wallet;
};

// 1. GET /wallet/balance - Fetch Wallet Details & Balances
export const getWalletBalance = async (req, res) => {
  try {
    const userId = req.userId;
    const currency = (req.query.currency || "NGN").toUpperCase();
    const wallet = await getOrCreateWallet(userId, currency);

    res.status(200).json({
      success: true,
      wallet: {
        currency: wallet.currency,
        availableBalance: wallet.availableBalance,
        ledgerBalance: wallet.ledgerBalance,
        virtualAccount: wallet.virtualAccount,
      },
    });
  } catch (error) {
    console.error("Get Wallet Error:", error);
    res.status(500).json({ success: false, message: "Error fetching wallet balance." });
  }
};

// 2. POST /wallet/generate-virtual-account - Generate Dedicated Funding Account
export const generateVirtualAccount = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const currency = (req.body.currency || "NGN").toUpperCase();
    const wallet = await getOrCreateWallet(userId, currency);

    if (wallet.virtualAccount.isGenerated) {
      return res.status(400).json({
        success: false,
        message: "Virtual account already generated.",
        virtualAccount: wallet.virtualAccount,
      });
    }

    // Mock generating account (Replace with Paystack / Monnify / Flutterwave API integration)
    const mockAccountNumber = "99" + Math.floor(10000000 + Math.random() * 90000000);
    const mockAccountName = `PAYFLEX / ${user.firstName.toUpperCase()} ${user.lastName.toUpperCase()}`;
    const mockBankName = "Wema Bank / PayFlex Microfinance";

    wallet.virtualAccount = {
      accountNumber: mockAccountNumber,
      accountName: mockAccountName,
      bankName: mockBankName,
      isGenerated: true,
    };

    await wallet.save();

    await createNotification(
      userId,
      "Virtual Account Generated",
      `Your virtual account (${wallet.virtualAccount.accountNumber}) has been generated successfully.`,
      "INFO"
    );

    res.status(200).json({
      success: true,
      message: "Dedicated virtual account generated successfully!",
      virtualAccount: wallet.virtualAccount,
    });
  } catch (error) {
    console.error("Generate Virtual Account Error:", error);
    res.status(500).json({ success: false, message: "Error generating virtual account." });
  }
};

// 3. POST /wallet/fund - Mock Fund Wallet (or Webhook simulation)
export const fundWallet = async (req, res) => {
  try {
    const userId = req.userId;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid amount greater than 0.",
      });
    }

    const currency = (req.body.currency || "NGN").toUpperCase();
    const wallet = await getOrCreateWallet(userId, currency);

    wallet.availableBalance += Number(amount);
    wallet.ledgerBalance += Number(amount);
    await wallet.save();

    res.status(200).json({
      success: true,
      message: `Successfully funded wallet with NGN ${amount}`,
      newBalance: wallet.availableBalance,
    });
  } catch (error) {
    console.error("Fund Wallet Error:", error);
    res.status(500).json({ success: false, message: "Error funding wallet." });
  }
};


export const transferFunds = async (req, res) => {
  const useTransaction =
    mongoose.connection.client?.topology?.description?.type === "ReplicaSetWithPrimary" ||
    mongoose.connection.client?.topology?.description?.type === "Sharded";

  let session = null;
  if (useTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const senderId = req.userId; // Extracted from JWT middleware
    const { recipientIdentifier, currency = "USD", amount, narration } = req.body;

    if (!recipientIdentifier || !amount || Number(amount) <= 0) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({
        success: false,
        message: "Recipient, valid amount, and currency are required.",
      });
    }

    const curr = currency.toUpperCase();

    // 1. Locate Recipient by email, tag, or phone
    const recipient = useTransaction
      ? await userModel
          .findOne({
            $or: [
              { email: recipientIdentifier.toLowerCase() },
              { username: recipientIdentifier.toLowerCase() },
              { phone: recipientIdentifier },
            ],
          })
          .session(session)
      : await userModel.findOne({
          $or: [
            { email: recipientIdentifier.toLowerCase() },
            { username: recipientIdentifier.toLowerCase() },
            { phone: recipientIdentifier },
          ],
        });

    if (!recipient) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(404).json({ success: false, message: "Recipient not found." });
    }

    if (recipient._id.toString() === senderId.toString()) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({ success: false, message: "Cannot transfer funds to yourself." });
    }

    // 2. Check Sender Wallet
    const senderWallet = useTransaction
      ? await walletModel.findOne({ userId: senderId, currency: curr }).session(session)
      : await walletModel.findOne({ userId: senderId, currency: curr });

    if (!senderWallet || senderWallet.availableBalance < Number(amount)) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({
        success: false,
        message: `Insufficient ${curr} wallet balance.`,
      });
    }

    // 3. Find or Create Recipient Wallet for Target Currency
    let recipientWallet = useTransaction
      ? await walletModel.findOne({ userId: recipient._id, currency: curr }).session(session)
      : await walletModel.findOne({ userId: recipient._id, currency: curr });

    if (!recipientWallet) {
      if (useTransaction) {
        const [newWallet] = await walletModel.create(
          [
            {
              userId: recipient._id,
              currency: curr,
              availableBalance: 0,
              ledgerBalance: 0,
            },
          ],
          { session }
        );
        recipientWallet = newWallet;
      } else {
        recipientWallet = await walletModel.create({
          userId: recipient._id,
          currency: curr,
          availableBalance: 0,
          ledgerBalance: 0,
        });
      }
    }

    const ref = `TRF_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Update Balances
    if (useTransaction) {
      senderWallet.availableBalance -= Number(amount);
      senderWallet.ledgerBalance -= Number(amount);
      await senderWallet.save({ session });

      recipientWallet.availableBalance += Number(amount);
      recipientWallet.ledgerBalance += Number(amount);
      await recipientWallet.save({ session });
    } else {
      await walletModel.findOneAndUpdate(
        { _id: senderWallet._id },
        { $inc: { availableBalance: -Number(amount), ledgerBalance: -Number(amount) } }
      );
      await walletModel.findOneAndUpdate(
        { _id: recipientWallet._id },
        { $inc: { availableBalance: Number(amount), ledgerBalance: Number(amount) } }
      );
    }

    // 5. Create Ledger Audit Records
    const senderTx = {
      userId: senderId,
      type: "DEBIT",
      amount: Number(amount),
      currency: curr,
      reference: `${ref}_SND`,
      narration: narration || `P2P Transfer of ${curr} to ${recipient.username || recipient.email}`,
      status: "SUCCESS",
    };

    const recipientTx = {
      userId: recipient._id,
      type: "CREDIT",
      amount: Number(amount),
      currency: curr,
      reference: `${ref}_RCV`,
      narration: narration || `P2P Transfer of ${curr} received`,
      status: "SUCCESS",
    };

    if (useTransaction) {
      await Transaction.create([senderTx, recipientTx], { session });
      await session.commitTransaction();
      await session.endSession();
    } else {
      await Transaction.create([senderTx, recipientTx]);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully transferred ${amount} ${curr}.`,
      reference: ref,
      newBalance: senderWallet.availableBalance - (useTransaction ? 0 : Number(amount)),
    });
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        await session.endSession();
      } catch (sErr) {
        // ignore session cleanup error
      }
    }
    console.error("Transfer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during transfer processing.",
      error: error.message,
    });
  }
};


export const getUserWallets = async (req, res) => {
  try {
    const userId = req.userId;

    const wallets = await walletModel.find({ userId });

    return res.status(200).json({
      status: true,
      message: "Wallets retrieved successfully",
      data: wallets.map((wallet) => {
        // Map currency symbol dynamically
        const currencySymbols = {
          NGN: "₦",
          USD: "$",
          EUR: "€",
          GBP: "£",
        };

        return {
          id: wallet._id,
          currency: wallet.currency,
          currency_code: wallet.currency,
          symbol: currencySymbols[wallet.currency] || "₦",
          balance: wallet.availableBalance,
          ledger_balance: wallet.ledgerBalance,
          virtual_account: wallet.virtualAccount,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve wallets",
      error: error.message,
    });
  }
};
