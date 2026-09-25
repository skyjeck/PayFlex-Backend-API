import mongoose from "mongoose";
import FxSwap from "../models/FxSwapModel.js";
import walletModel from "../models/WalletModel.js";
import { getClientFxRate, getLiveFxRates } from "./FxRateService.js";
import { createNotification } from "./NotificationController.js";

const quoteCache = new Map();

const generateTxRef = () => `PF-SWAP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// Constant Flat Fee Base
const FIXED_FEE_NGN = 500;

/**
 * Helper: Calculates source-equivalent fee based on source currency
 */
const calculateSourceFee = async (sourceCurrency) => {
  const sourceCurr = sourceCurrency.toUpperCase();
  if (sourceCurr === "NGN") {
    return 500;
  }
  // Convert 1,000 NGN to source currency (e.g., NGN -> USD)
  const { clientRate } = await getClientFxRate("NGN", sourceCurr);
  return Number((FIXED_FEE_NGN * clientRate).toFixed(2));
};

// GET /api/v1/swap-fx/rates?base=USD
export const getFxRates = async (req, res) => {
  try {
    const baseCurrency = (req.query.base || "USD").toUpperCase();
    const supportedCurrencies = ["NGN", "USD", "GBP", "EUR"];

    const liveData = await getLiveFxRates(baseCurrency);

    const clientRates = {};
    for (const currency of supportedCurrencies) {
      if (currency === baseCurrency) {
        clientRates[currency] = 1.0;
      } else {
        const { clientRate } = await getClientFxRate(baseCurrency, currency);
        clientRates[currency] = clientRate;
      }
    }

    return res.status(200).json({
      success: true,
      baseCurrency,
      rates: clientRates,
      source: liveData?.source || "live",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Fetch FX Rates Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve real-time rates.",
      error: error.message,
    });
  }
};

// POST /api/v1/swap-fx/quote - Get Binding FX Quote
export const getQuote = async (req, res) => {
  try {
    const sourceCurrency = (req.body.from_currency || req.body.sourceCurrency || "").toUpperCase();
    const targetCurrency = (req.body.to_currency || req.body.targetCurrency || "").toUpperCase();
    const rawAmount = req.body.amount || req.body.sourceAmount;

    if (!sourceCurrency || !targetCurrency || !rawAmount) {
      return res.status(400).json({
        success: false,
        message: "from_currency, to_currency, and amount are required.",
      });
    }

    const amount = Number(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be a valid positive number.",
      });
    }

    // 1. Get market conversion rate
    const { clientRate } = await getClientFxRate(sourceCurrency, targetCurrency);
    const destinationAmount = Number((amount * clientRate).toFixed(2));

    // 2. Calculate fee equivalent in source currency
    const feeInSource = await calculateSourceFee(sourceCurrency);
    const totalDeduction = Number((amount + feeInSource).toFixed(2));

    const quoteId = `QUOTE-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = Date.now() + 60 * 1000; // 60s validity

    const quoteData = {
      quoteId,
      userId: req.userId,
      sourceCurrency,
      targetCurrency,
      sourceAmount: amount,
      targetAmount: destinationAmount,
      rate: clientRate,
      fee: feeInSource,
      feeNgn: FIXED_FEE_NGN,
      totalDeduction,
      expiresAt,
    };

    quoteCache.set(quoteId, quoteData);

    return res.status(200).json({
      success: true,
      quoteId,
      rate: clientRate,
      fee: feeInSource,
      feeNgn: FIXED_FEE_NGN,
      destinationAmount,
      totalDeduction,
      quote: {
        quoteId,
        sourceCurrency: quoteData.sourceCurrency,
        targetCurrency: quoteData.targetCurrency,
        sourceAmount: quoteData.sourceAmount,
        targetAmount: quoteData.targetAmount,
        rate: clientRate,
        fee: feeInSource,
        feeNgn: FIXED_FEE_NGN,
        totalDeduction,
        expiresInSeconds: 30,
        expiresAt: new Date(expiresAt),
      },
    });
  } catch (error) {
    console.error("FX Get Quote Internal Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate quote.",
      error: error.message,
    });
  }
};

const isTransactionSupported = () => {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === "ReplicaSetWithPrimary" || type === "Sharded";
};


// POST /api/v1/swap-fx/execute - Execute Swap Order
export const executeSwap = async (req, res) => {
  const useTransaction = isTransactionSupported();
  let session = null;

  if (useTransaction) {
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch (_) {
      session = null;
    }
  }

  const abortAndEndSession = async () => {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
      session.endSession();
      session = null;
    }
  };

  try {
    const userId = req.userId;
    const { quoteId } = req.body;

    const sourceCurr = (req.body.from_currency || req.body.sourceCurrency || "").toUpperCase();
    const targetCurr = (req.body.to_currency || req.body.targetCurrency || "").toUpperCase();
    const sourceAmount = Number(req.body.source_amount || req.body.sourceAmount);

    let quote = null;

    if (quoteId) {
      quote = quoteCache.get(quoteId);
      if (!quote) {
        await abortAndEndSession();
        return res.status(404).json({ success: false, message: "Quote not found or expired." });
      }

      if (Date.now() > quote.expiresAt) {
        quoteCache.delete(quoteId);
        await abortAndEndSession();
        return res.status(400).json({ success: false, message: "Quote has expired." });
      }
    } else {
      // Direct Execution Fallback
      if (!sourceCurr || !targetCurr || !sourceAmount) {
        await abortAndEndSession();
        return res.status(400).json({
          success: false,
          message: "from_currency, to_currency, and source_amount are required.",
        });
      }

      const { clientRate } = await getClientFxRate(sourceCurr, targetCurr);
      const targetAmount = Number((sourceAmount * clientRate).toFixed(2));
      const feeInSource = await calculateSourceFee(sourceCurr);
      const totalDeduction = Number((sourceAmount + feeInSource).toFixed(2));

      quote = {
        sourceCurrency: sourceCurr,
        targetCurrency: targetCurr,
        sourceAmount,
        targetAmount,
        rate: clientRate,
        fee: feeInSource,
        feeNgn: FIXED_FEE_NGN,
        totalDeduction,
      };
    }

    // 1. Fetch Source Wallet
    const sourceWallet = session
      ? await walletModel.findOne({ userId, currency: quote.sourceCurrency }).session(session)
      : await walletModel.findOne({ userId, currency: quote.sourceCurrency });

    if (!sourceWallet) {
      await abortAndEndSession();
      return res.status(404).json({
        success: false,
        message: `No ${quote.sourceCurrency} wallet found for this account.`,
      });
    }

    // 2. Check Available Balance against Total Deduction
    if (sourceWallet.availableBalance < quote.totalDeduction) {
      await abortAndEndSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient ${quote.sourceCurrency} balance. Total required: ${quote.totalDeduction}, Available: ${sourceWallet.availableBalance}`,
      });
    }

    // 3. Find or Create Target Wallet (Atomic Upsert / Safe Retry)
    let targetWallet;
    try {
      if (session) {
        targetWallet = await walletModel.findOne({ userId, currency: quote.targetCurrency }).session(session);
        if (!targetWallet) {
          const created = await walletModel.create(
            [{ userId, currency: quote.targetCurrency, availableBalance: 0, ledgerBalance: 0 }],
            { session }
          );
          targetWallet = created[0];
        }
      } else {
        // Atomic Upsert using findOneAndUpdate to prevent duplicate key race conditions
        targetWallet = await walletModel.findOneAndUpdate(
          { userId, currency: quote.targetCurrency },
          { $setOnInsert: { userId, currency: quote.targetCurrency, availableBalance: 0, ledgerBalance: 0 } },
          { upsert: true, new: true }
        );
      }
    } catch (err) {
      // Fallback lookup if E11000 duplicate key error triggers in race condition
      if (err.code === 11000) {
        targetWallet = await walletModel.findOne({ userId, currency: quote.targetCurrency });
      } else {
        throw err;
      }
    }

    // 4. Atomic Balance Deductions
    const updatedSource = session
      ? await walletModel.findOneAndUpdate(
          { _id: sourceWallet._id, availableBalance: { $gte: quote.totalDeduction } },
          { $inc: { availableBalance: -quote.totalDeduction, ledgerBalance: -quote.totalDeduction } },
          { new: true, session }
        )
      : await walletModel.findOneAndUpdate(
          { _id: sourceWallet._id, availableBalance: { $gte: quote.totalDeduction } },
          { $inc: { availableBalance: -quote.totalDeduction, ledgerBalance: -quote.totalDeduction } },
          { new: true }
        );

    if (!updatedSource) {
      await abortAndEndSession();
      return res.status(400).json({ success: false, message: "Balance update collision or insufficient funds." });
    }

    const updatedTarget = session
      ? await walletModel.findByIdAndUpdate(
          targetWallet._id,
          { $inc: { availableBalance: quote.targetAmount, ledgerBalance: quote.targetAmount } },
          { new: true, session }
        )
      : await walletModel.findByIdAndUpdate(
          targetWallet._id,
          { $inc: { availableBalance: quote.targetAmount, ledgerBalance: quote.targetAmount } },
          { new: true }
        );

    // 5. Audit Record Creation
    const reference = generateTxRef();
    const swapDoc = {
      userId,
      reference,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      sourceAmount: quote.sourceAmount,
      targetAmount: quote.targetAmount,
      exchangeRate: quote.rate,
      fee: quote.fee,
      feeNgn: quote.feeNgn,
      totalDeducted: quote.totalDeduction,
      status: "COMPLETED",
    };

    if (session) {
      await FxSwap.create([swapDoc], { session });
      await session.commitTransaction();
      session.endSession();
    } else {
      await FxSwap.create(swapDoc);
    }

    if (quoteId) quoteCache.delete(quoteId);

    await createNotification(
      userId,
      "FX Swap Successful",
      `Successfully swapped ${quote.sourceCurrency} ${quote.sourceAmount} to ${quote.targetCurrency} ${quote.targetAmount}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: "Swap executed successfully!",
      reference,
      swappedFrom: `${quote.sourceCurrency} ${quote.sourceAmount}`,
      feeCharged: `${quote.sourceCurrency} ${quote.fee}`,
      totalDeducted: `${quote.sourceCurrency} ${quote.totalDeduction}`,
      receivedTo: `${quote.targetCurrency} ${quote.targetAmount}`,
      rate: quote.rate,
      newSourceBalance: updatedSource.availableBalance,
      newTargetBalance: updatedTarget.availableBalance,
    });
  } catch (error) {
    await abortAndEndSession();
    console.error("Execute Swap Error:", error);
    return res.status(500).json({
      success: false,
      message: "Swap execution failed.",
      error: error.message,
    });
  }
};
// GET /api/v1/swap-fx/history
export const getSwapHistory = async (req, res) => {
  try {
    const userId = req.userId || req.params.userId;
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [swaps, total] = await Promise.all([
      FxSwap.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      FxSwap.countDocuments({ userId }),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
      data: swaps,
    });
  } catch (e) {
    console.error("Fetch Swap History Error:", e);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching swap history.",
      error: e.message,
    });
  }
};