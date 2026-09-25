import axios from "axios";
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

// 1. GET /api/v1/transfers/banks - Retrieve Live List of Supported Banks
export const getSupportedBanks = async (req, res) => {
  try {
    const response = await axios.get("https://api.paystack.co/bank?country=nigeria", {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    const banks = response.data.data.map((bank) => ({
      name: bank.name,
      code: bank.code,
      longcode: bank.longcode,
      active: bank.active,
    }));

    res.status(200).json({
      success: true,
      count: banks.length,
      banks,
    });
  } catch (error) {
    console.error("Fetch Live Banks Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Error retrieving supported banks from payment provider.",
    });
  }
};

// 2. POST /api/v1/transfers/bank-lookup - Resolve Account Number via Paystack
// export const resolveBankAccount = async (req, res) => {
//   try {
//     const { accountNumber, bankCode } = req.body;

//     if (!accountNumber || !bankCode) {
//       return res.status(400).json({
//         success: false,
//         message: "Account number and bank code are required.",
//       });
//     }

//     if (accountNumber.length !== 10) {
//       return res.status(400).json({
//         success: false,
//         message: "Account number must be exactly 10 digits.",
//       });
//     }

//     const response = await axios.get(
//       `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
//         },
//       }
//     );

//     res.status(200).json({
//       success: true,
//       accountNumber: response.data.data.account_number,
//       accountName: response.data.data.account_name,
//       bankCode,
//     });
//   } catch (error) {
//     console.error("Account Resolve Error:", error.response?.data || error.message);
//     res.status(400).json({
//       success: false,
//       message: "Could not resolve bank account details. Verify details and try again.",
//     });
//   }
// };

export const resolveBankAccount = async (req, res) => {
  try {
    const { transferType, recipient, accountNumber, bankCode } = req.body;
    const targetIdentifier = accountNumber || recipient;

    const isInternal =
  (transferType && transferType.toUpperCase() === "INTERNAL") ||
  (!transferType && (bankCode === "001" || bankCode === "PAYFLEX" || (!bankCode && targetIdentifier)));

    // ---------------- INTERNAL PayFlex Transfer Lookup ----------------
    if (isInternal) {
      if (!targetIdentifier) {
        return res.status(400).json({
          success: false,
          message: "Account number or recipient email/phone is required for PayFlex transfers.",
        });
      }

      // 1. Try finding wallet by PayFlex virtual account number
      let wallet = await walletModel.findOne({ "virtualAccount.accountNumber": targetIdentifier });
      let recipientUser = null;

      if (wallet) {
        recipientUser = await userModel.findById(wallet.userId);
      } else {
        // 2. Try finding user by email or phone
        recipientUser = await userModel.findOne({
          $or: [{ email: targetIdentifier.toLowerCase() }, { phone: targetIdentifier }],
        });
        if (recipientUser) {
          wallet = await walletModel.findOne({ userId: recipientUser._id, currency: "NGN" });
        }
      }

      if (recipientUser) {
        return res.status(200).json({
          success: true,
          transferType: "INTERNAL",
          accountName: `${recipientUser.firstName} ${recipientUser.lastName}`,
          accountNumber: wallet?.virtualAccount?.accountNumber || targetIdentifier,
          recipient: targetIdentifier,
          bankCode: bankCode || "001",
        });
      }

      // Fallback for dev / mock testing with bankCode "001" if user not in DB
      if (bankCode === "001" && process.env.NODE_ENV !== "production") {
        return res.status(200).json({
          success: true,
          accountNumber: targetIdentifier,
          accountName: "TEST ACCOUNT USER",
          bankCode: "001",
        });
      }

      return res.status(404).json({
        success: false,
        message: "No PayFlex account found for the provided details.",
      });
    }

    // ---------------- EXTERNAL Bank Transfer Lookup ----------------
    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "Account number and bank code are required.",
      });
    }

    if (accountNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Account number must be exactly 10 digits.",
      });
    }

    // Bypass Paystack rate limits during local development if testing dummy accounts
    if (process.env.NODE_ENV !== "production" && bankCode === "001") {
      return res.status(200).json({
        success: true,
        accountNumber,
        accountName: "TEST ACCOUNT USER",
        bankCode,
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    res.status(200).json({
      success: true,
      accountNumber: response.data.data.account_number,
      accountName: response.data.data.account_name,
      bankCode,
    });
  } catch (error) {
    console.error("Account Resolve Error:", error.response?.data || error.message);

    // Return actual Paystack error message for easier debugging
    const errorMessage = error.response?.data?.message || "Could not resolve bank account details.";

    res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }
};

// 3. POST /api/v1/transfers/send-money - Send to External Bank or Internal PayFlex Account
export const sendMoney = async (req, res) => {
  const useTransaction = isTransactionSupported();
  let session = null;

  if (useTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const senderId = req.userId;
    const { transferType, recipient, bankCode, bankName, accountNumber, accountName, amount, narration } = req.body;

    if (!transferType || !["INTERNAL", "EXTERNAL"].includes(transferType.toUpperCase())) {
      if (session) {
        await session.endSession();
      }
      return res.status(400).json({
        success: false,
        message: "Invalid transferType. Choose 'INTERNAL' or 'EXTERNAL'.",
      });
    }

    if (!amount || amount <= 0) {
      if (session) {
        await session.endSession();
      }
      return res.status(400).json({ success: false, message: "Enter a valid transfer amount." });
    }

    const senderWallet = useTransaction
      ? await walletModel.findOne({ userId: senderId }).session(session)
      : await walletModel.findOne({ userId: senderId });

    if (!senderWallet || senderWallet.availableBalance < amount) {
      if (session) {
        await session.abortTransaction();
        await session.endSession();
      }
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }

    const reference = generateTxRef();

    // ---------------- INTERNAL PAYFLEX TRANSFER ----------------
    if (transferType.toUpperCase() === "INTERNAL") {
      if (!recipient && !accountNumber) {
        if (session) {
          await session.endSession();
        }
        return res.status(400).json({
          success: false,
          message: "Recipient email, phone, or account number is required.",
        });
      }

      const searchIdentifier = recipient || accountNumber;

      let recipientWallet = useTransaction
        ? await walletModel.findOne({ "virtualAccount.accountNumber": searchIdentifier }).session(session)
        : await walletModel.findOne({ "virtualAccount.accountNumber": searchIdentifier });

      let recipientUser = null;

      if (recipientWallet) {
        recipientUser = useTransaction
          ? await userModel.findById(recipientWallet.userId).session(session)
          : await userModel.findById(recipientWallet.userId);
      } else {
        recipientUser = useTransaction
          ? await userModel
              .findOne({
                $or: [{ email: searchIdentifier }, { phone: searchIdentifier }],
              })
              .session(session)
          : await userModel.findOne({
              $or: [{ email: searchIdentifier }, { phone: searchIdentifier }],
            });

        if (recipientUser) {
          recipientWallet = useTransaction
            ? await walletModel.findOne({ userId: recipientUser._id }).session(session)
            : await walletModel.findOne({ userId: recipientUser._id });

          if (!recipientWallet) {
            recipientWallet = new walletModel({ userId: recipientUser._id });
          }
        }
      }

      if (!recipientUser) {
        if (session) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(404).json({ success: false, message: "PayFlex recipient not found." });
      }

      if (recipientUser._id.toString() === senderId.toString()) {
        if (session) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(400).json({
          success: false,
          message: "Cannot transfer money to your own account.",
        });
      }

      // Execute Balance Deductions & Credits
      if (useTransaction) {
        senderWallet.availableBalance -= Number(amount);
        senderWallet.ledgerBalance -= Number(amount);
        recipientWallet.availableBalance += Number(amount);
        recipientWallet.ledgerBalance += Number(amount);

        await senderWallet.save({ session });
        await recipientWallet.save({ session });

        await transactionModel.create(
          [
            {
              userId: senderId,
              type: "TRANSFER",
              amount: Number(amount),
              reference,
              recipientAccount: recipientUser.email,
              recipientName: `${recipientUser.firstName} ${recipientUser.lastName}`,
              narration: narration || "PayFlex Internal Transfer",
              status: "SUCCESS",
            },
            {
              userId: recipientUser._id,
              type: "FUNDING",
              amount: Number(amount),
              reference: `${reference}-IN`,
              recipientAccount: recipientUser.email,
              recipientName: `${recipientUser.firstName} ${recipientUser.lastName}`,
              narration: narration || "PayFlex Internal Credit",
              status: "SUCCESS",
            },
          ],
          { session }
        );

        await session.commitTransaction();
        await session.endSession();
      } else {
        await walletModel.findOneAndUpdate(
          { _id: senderWallet._id },
          { $inc: { availableBalance: -Number(amount), ledgerBalance: -Number(amount) } }
        );
        if (recipientWallet._id) {
          await walletModel.findOneAndUpdate(
            { _id: recipientWallet._id },
            { $inc: { availableBalance: Number(amount), ledgerBalance: Number(amount) } }
          );
        } else {
          recipientWallet.availableBalance = Number(amount);
          recipientWallet.ledgerBalance = Number(amount);
          await recipientWallet.save();
        }

        await transactionModel.create([
          {
            userId: senderId,
            type: "TRANSFER",
            amount: Number(amount),
            reference,
            recipientAccount: recipientUser.email,
            recipientName: `${recipientUser.firstName} ${recipientUser.lastName}`,
            narration: narration || "PayFlex Internal Transfer",
            status: "SUCCESS",
          },
          {
            userId: recipientUser._id,
            type: "FUNDING",
            amount: Number(amount),
            reference: `${reference}-IN`,
            recipientAccount: recipientUser.email,
            recipientName: `${recipientUser.firstName} ${recipientUser.lastName}`,
            narration: narration || "PayFlex Internal Credit",
            status: "SUCCESS",
          },
        ]);
      }

      await createNotification(
        senderId,
        "Internal Transfer Successful",
        `You have successfully transferred NGN ${amount} to ${recipientUser.firstName} ${recipientUser.lastName}.`,
        "TRANSACTION"
      );

      await createNotification(
        recipientUser._id,
        "Funds Received",
        `You have received NGN ${amount} from a PayFlex contact.`,
        "TRANSACTION"
      );

      return res.status(200).json({
        success: true,
        message: "Internal transfer completed successfully!",
        reference,
        newBalance: senderWallet.availableBalance - (useTransaction ? 0 : Number(amount)),
      });
    }

    // ---------------- EXTERNAL BANK TRANSFER (PAYSTACK INTEGRATION) ----------------
    if (transferType.toUpperCase() === "EXTERNAL") {
      if (!bankCode || !accountNumber || !accountName) {
        if (session) {
          await session.endSession();
        }
        return res.status(400).json({
          success: false,
          message: "bankCode, accountNumber, and accountName are required for external transfers.",
        });
      }

      let paystackStatus = "SUCCESS";
      let isSimulated = false;

      if (process.env.NODE_ENV !== "production" && bankCode === "001") {
        isSimulated = true;
        paystackStatus = "SUCCESS";
      } else {
        try {
          // 1. Create Transfer Recipient on Paystack
          const recipientResponse = await axios.post(
            "https://api.paystack.co/transferrecipient",
            {
              type: "nuban",
              name: accountName,
              account_number: accountNumber,
              bank_code: bankCode,
              currency: "NGN",
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );

          const recipientCode = recipientResponse.data.data.recipient_code;

          // 2. Initiate Transfer on Paystack
          const transferResponse = await axios.post(
            "https://api.paystack.co/transfer",
            {
              source: "balance",
              amount: Number(amount) * 100, // Paystack expects amount in Kobo
              recipient: recipientCode,
              reason: narration || "PayFlex Bank Transfer",
              reference,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
              },
            }
          );

          paystackStatus = transferResponse.data.data.status === "success" ? "SUCCESS" : "PENDING";
        } catch (paystackError) {
          const paystackMsg = paystackError.response?.data?.message || paystackError.message || "";
          if (paystackMsg.toLowerCase().includes("starter business") || paystackMsg.toLowerCase().includes("payouts")) {
            console.warn("⚠️ Paystack Starter Business limitation detected — processing as SIMULATED transfer for local testing.");
            paystackStatus = "SUCCESS";
            isSimulated = true;
          } else {
            throw paystackError;
          }
        }
      }

      if (useTransaction) {
        senderWallet.availableBalance -= Number(amount);
        senderWallet.ledgerBalance -= Number(amount);
        await senderWallet.save({ session });

        await transactionModel.create(
          [
            {
              userId: senderId,
              type: "WITHDRAWAL",
              amount: Number(amount),
              reference,
              bankCode,
              bankName: bankName || "External Bank",
              recipientAccount: accountNumber,
              recipientName: accountName,
              narration: isSimulated
                ? `[SIMULATED] ${narration || "External Bank Transfer"}`
                : narration || "External Bank Transfer",
              status: paystackStatus,
            },
          ],
          { session }
        );

        await session.commitTransaction();
        await session.endSession();
      } else {
        await walletModel.findOneAndUpdate(
          { _id: senderWallet._id },
          { $inc: { availableBalance: -Number(amount), ledgerBalance: -Number(amount) } }
        );

        await transactionModel.create({
          userId: senderId,
          type: "WITHDRAWAL",
          amount: Number(amount),
          reference,
          bankCode,
          bankName: bankName || "External Bank",
          recipientAccount: accountNumber,
          recipientName: accountName,
          narration: isSimulated
            ? `[SIMULATED] ${narration || "External Bank Transfer"}`
            : narration || "External Bank Transfer",
          status: paystackStatus,
        });
      }

      await createNotification(
        senderId,
        "External Transfer Initiated",
        `Your transfer of NGN ${amount} to ${accountName} has been initiated.`,
        "TRANSACTION"
      );

      return res.status(200).json({
        success: true,
        message: isSimulated
          ? `[SIMULATED] Transfer of NGN ${amount} completed to ${accountName}`
          : `Transfer of NGN ${amount} initiated to ${accountName}`,
        reference,
        newBalance: senderWallet.availableBalance - (useTransaction ? 0 : Number(amount)),
        paystackStatus,
        isSimulated,
      });
    }
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
        await session.endSession();
      } catch (sErr) {
        // ignore
      }
    }
    console.error("Send Money Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Error processing transfer.",
    });
  }
};

// GET /api/v1/transfers/history - Retrieve transaction history for logged-in user
export const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, type } = req.query;

    const query = { userId };
    if (type) {
      query.type = type.toUpperCase();
    }

    const transactions = await transactionModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await transactionModel.countDocuments(query);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      transactions,
    });
  } catch (error) {
    console.error("Get Transaction History Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching transaction history.",
    });
  }
};