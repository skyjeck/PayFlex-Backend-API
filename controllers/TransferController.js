import mongoose from "mongoose";
import walletModel from "../models/WalletModel.js";
import transactionModel from "../models/TransactionModel.js";
import userModel from "../models/UserModel.js";
import { createNotification } from "./NotificationController.js";

// Helper: Generate Unique Reference
const generateTxRef = () => `PF-TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// Helper: Check if current MongoDB deployment supports ACID transactions
const isTransactionSupported = () => {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === "ReplicaSetWithPrimary" || type === "Sharded";
};

// 1. POST /api/v1/transfers/wallet - Internal Wallet-to-Wallet Transfer
export const transferToWallet = async (req, res) => {
  const useTransaction = isTransactionSupported();
  let session = null;

  if (useTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const senderId = req.userId;
    const { recipientAccount, amount, currency = "NGN", narration } = req.body;

    if (!recipientAccount || !amount || Number(amount) <= 0) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({ 
        success: false, 
        message: "Recipient account number and valid amount are required." 
      });
    }

    const transferAmount = Number(amount);
    const targetCurrency = currency.toUpperCase();

    // 1. Find Sender Wallet for SPECIFIC Currency
    const senderWallet = useTransaction
      ? await walletModel.findOne({ userId: senderId, currency: targetCurrency }).session(session)
      : await walletModel.findOne({ userId: senderId, currency: targetCurrency });

    if (!senderWallet || senderWallet.availableBalance < transferAmount) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient ${targetCurrency} wallet balance.` 
      });
    }

    // 2. Find Recipient Wallet by PayFlex Account Number
    const recipientWalletByAccount = useTransaction
      ? await walletModel.findOne({ "virtualAccount.accountNumber": recipientAccount }).session(session)
      : await walletModel.findOne({ "virtualAccount.accountNumber": recipientAccount });

    if (!recipientWalletByAccount) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(404).json({ success: false, message: "Recipient PayFlex account not found." });
    }

    // 3. Find Recipient User from the resolved wallet
    const recipientUser = useTransaction
      ? await userModel.findById(recipientWalletByAccount.userId).session(session)
      : await userModel.findById(recipientWalletByAccount.userId);

    if (!recipientUser) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(404).json({ success: false, message: "Recipient user not found." });
    }

    if (recipientUser._id.toString() === senderId.toString()) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({ success: false, message: "You cannot transfer money to yourself." });
    }

    // 4. Find or Auto-Create Recipient Wallet for Target Currency
    let recipientWallet = useTransaction
      ? await walletModel.findOne({ userId: recipientUser._id, currency: targetCurrency }).session(session)
      : await walletModel.findOne({ userId: recipientUser._id, currency: targetCurrency });

    if (!recipientWallet) {
      if (useTransaction) {
        const [newWallet] = await walletModel.create(
          [{ userId: recipientUser._id, currency: targetCurrency, availableBalance: 0, ledgerBalance: 0 }],
          { session }
        );
        recipientWallet = newWallet;
      } else {
        recipientWallet = await walletModel.create({
          userId: recipientUser._id,
          currency: targetCurrency,
          availableBalance: 0,
          ledgerBalance: 0,
        });
      }
    }

    // 5. Update Wallet Balances
    if (useTransaction) {
      senderWallet.availableBalance -= transferAmount;
      senderWallet.ledgerBalance -= transferAmount;
      recipientWallet.availableBalance += transferAmount;
      recipientWallet.ledgerBalance += transferAmount;

      await senderWallet.save({ session });
      await recipientWallet.save({ session });
    } else {
      // Atomic increment/decrement when ReplicaSet transactions aren't supported
      await walletModel.findOneAndUpdate(
        { _id: senderWallet._id },
        { $inc: { availableBalance: -transferAmount, ledgerBalance: -transferAmount } }
      );
      await walletModel.findOneAndUpdate(
        { _id: recipientWallet._id },
        { $inc: { availableBalance: transferAmount, ledgerBalance: transferAmount } }
      );
    }

    const reference = generateTxRef();

    // 6. Audit Trail Entries
    const recipientFullName = `${recipientUser.firstName} ${recipientUser.lastName}`;

    const senderTx = {
      userId: senderId,
      type: "DEBIT",
      amount: transferAmount,
      currency: targetCurrency,
      reference: `${reference}_SND`,
      recipientAccount,
      recipientName: recipientFullName,
      narration: narration || `P2P Transfer of ${targetCurrency} Out`,
      status: "SUCCESS",
    };

    const recipientTx = {
      userId: recipientUser._id,
      type: "CREDIT",
      amount: transferAmount,
      currency: targetCurrency,
      reference: `${reference}_RCV`,
      recipientAccount,
      recipientName: recipientFullName,
      narration: narration || `P2P Transfer of ${targetCurrency} In`,
      status: "SUCCESS",
    };

    if (useTransaction) {
      await transactionModel.create([senderTx], { session });
      await transactionModel.create([recipientTx], { session });
      await session.commitTransaction();
      await session.endSession();
    } else {
      await transactionModel.create(senderTx);
      await transactionModel.create(recipientTx);
    }

    await createNotification(
      senderId,
      "Transfer Successful",
      `You have successfully transferred ${targetCurrency} ${transferAmount} to ${recipientFullName}.`,
      "TRANSACTION"
    );

    await createNotification(
      recipientUser._id,
      "Funds Received",
      `You have received ${targetCurrency} ${transferAmount} from your PayFlex contact.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: "Transfer completed successfully!",
      reference,
      currency: targetCurrency,
      recipientName: recipientFullName,
      recipientAccount,
      newBalance: senderWallet.availableBalance - (useTransaction ? 0 : transferAmount),
    });
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        await session.endSession();
      } catch (sErr) {
        // Ignore session cleanup errors
      }
    }
    console.error("Wallet Transfer Error:", error);
    return res.status(500).json({ success: false, message: "Transfer failed to process." });
  }
};

// 3. GET /api/v1/transfers/lookup?accountNumber=XXXXXXXXXX - Resolve PayFlex Account Number to User Name
export const lookupPayflexAccount = async (req, res) => {
  try {
    const { accountNumber } = req.query;

    if (!accountNumber) {
      return res.status(400).json({ success: false, message: "Account number is required." });
    }

    const wallet = await walletModel.findOne({ "virtualAccount.accountNumber": accountNumber }).lean();

    if (!wallet) {
      return res.status(404).json({ success: false, message: "No PayFlex account found with that account number." });
    }

    const user = await userModel.findById(wallet.userId).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "Account owner not found." });
    }

    return res.status(200).json({
      success: true,
      accountNumber: wallet.virtualAccount.accountNumber,
      accountName: `${user.firstName} ${user.lastName}`,
    });
  } catch (error) {
    console.error("Lookup PayFlex Account Error:", error);
    return res.status(500).json({ success: false, message: "Error resolving account number." });
  }
};

// 2. GET /api/v1/transfers/history - Get User Transaction History
export const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, type, currency } = req.query;

    const query = { userId };
    if (type) query.type = type.toUpperCase();
    if (currency) query.currency = currency.toUpperCase();

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));

    const [transactions, total] = await Promise.all([
      transactionModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      transactionModel.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      transactions,
    });
  } catch (error) {
    console.error("Get Transactions Error:", error);
    return res.status(500).json({ success: false, message: "Error fetching transaction history." });
  }
};