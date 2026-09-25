import Transaction from "../models/TransactionModel.js";
import ServiceTransaction from "../models/ServiceModel.js";
import Fxswap from "../models/FxSwapModel.js";

export const getUnifiedHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20, module } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));

    // Prepare queries
    let transactionsQuery = { userId };
    let servicesQuery = { userId };
    let swapsQuery = { userId };
    
    let fetchTransactions = true;
    let fetchServices = true;
    let fetchSwaps = true;

    if (module) {
        const modLower = module.toLowerCase();
        if (modLower === 'wallet' || modLower === 'transfer') {
            fetchServices = false;
            fetchSwaps = false;
        } else if (['electricity', 'cable', 'airtime', 'data'].includes(modLower)) {
            fetchTransactions = false;
            fetchSwaps = false;
            if (modLower === 'cable') servicesQuery.category = 'CABLE_TV';
            else servicesQuery.category = modLower.toUpperCase();
        } else if (modLower === 'swap') {
            fetchTransactions = false;
            fetchServices = false;
        }
    }

    const [transactions, services, swaps] = await Promise.all([
      fetchTransactions ? Transaction.find(transactionsQuery).lean() : Promise.resolve([]),
      fetchServices ? ServiceTransaction.find(servicesQuery).lean() : Promise.resolve([]),
      fetchSwaps ? Fxswap.find(swapsQuery).lean() : Promise.resolve([])
    ]);

    // Build a set of references already covered by service records so we don't
    // show a duplicate general-ledger receipt for the same purchase
    const serviceRefs = new Set(services.map(s => s.reference).filter(Boolean));

    // Normalize and add module tags — exclude any transaction that has a matching
    // service record (same reference), since service receipts are richer
    const normalizedTransactions = transactions
      .filter(t => !serviceRefs.has(t.reference))
      .map(t => ({
        ...t,
        unifiedModule: t.type ? t.type.toLowerCase() : 'transfer',
        isDebit: t.isDebit ?? (t.type === 'DEBIT' || t.direction === 'OUTGOING')
      }));

    const normalizedServices = services.map(s => {
      const category = s.category ? s.category.toUpperCase() : '';
      const isElectricity = category === 'ELECTRICITY';

      // Safe extraction of electricity token across common schema locations
      const token =
        s.token ||
        s.meterToken ||
        s.metadata?.token ||
        s.details?.token ||
        s.responseData?.token ||
        null;

      const meterNumber =
        s.meterNumber ||
        s.metadata?.meterNumber ||
        s.details?.meterNumber ||
        s.accountNumber ||
        null;

      const customerName =
        s.customerName ||
        s.metadata?.customerName ||
        s.recipientName ||
        s.recipient ||
        null;

      const provider =
        s.provider ||
        s.metadata?.provider ||
        s.billerName ||
        null;

      return {
        ...s,
        unifiedModule: s.category ? s.category.toLowerCase().replace('_tv', '') : 'service',
        title: s.title || (isElectricity ? `${provider || 'Electricity'} Bill` : `${category} Payment`),
        isDebit: true, // Service purchases are debits
        token,         // Placed at top level for Flutter receipt widget (txn['token'])
        meterNumber,
        customerName,
        provider,
        recipient: customerName || meterNumber || s.recipient || '—'
      };
    });

    const normalizedSwaps = swaps.map(s => ({
      ...s,
      unifiedModule: 'swap',
      title: `FX Swap (${s.sourceCurrency} ➔ ${s.targetCurrency})`,
      isDebit: true,
      amount: s.totalDeducted || s.sourceAmount,
      currency: s.sourceCurrency
    }));

    let allHistory = [...normalizedTransactions, ...normalizedServices, ...normalizedSwaps];

    // Sort descending by createdAt
    allHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    const total = allHistory.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedHistory = allHistory.slice(startIndex, startIndex + limitNum);

    return res.status(200).json({
      success: true,
      message: "Unified transaction history retrieved successfully",
      data: {
        history: paginatedHistory,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error("Error fetching unified history:", error);
    return res.status(500).json({ success: false, message: "Error fetching transaction history." });
  }
};

// GET /api/history/receipt/:reference
// Unified single-receipt lookup — works for all transaction types.
// The Share Receipt button calls this to get a complete, normalised receipt
// regardless of whether the transaction is a service (electricity/airtime/data/cable)
// or a wallet movement (transfer/funding/withdrawal).
export const getReceiptByReference = async (req, res) => {
  try {
    const userId = req.userId;
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Transaction reference is required." });
    }

    // 1. Check service transactions first (richer data — has token, meterNumber, etc.)
    const serviceRecord = await ServiceTransaction.findOne({ reference, userId }).lean();

    if (serviceRecord) {
      const category = serviceRecord.category ? serviceRecord.category.toUpperCase() : '';
      const isElectricity = category === 'ELECTRICITY';

      const token =
        serviceRecord.token ||
        serviceRecord.meterToken ||
        serviceRecord.metadata?.token ||
        null;

      const meterNumber =
        serviceRecord.meterNumber ||
        serviceRecord.metadata?.meterNumber ||
        serviceRecord.accountNumber ||
        null;

      const customerName =
        serviceRecord.customerName ||
        serviceRecord.metadata?.customerName ||
        serviceRecord.recipientName ||
        null;

      const provider =
        serviceRecord.provider ||
        serviceRecord.metadata?.provider ||
        serviceRecord.billerName ||
        null;

      return res.status(200).json({
        success: true,
        receipt: {
          ...serviceRecord,
          receiptType: 'service',
          unifiedModule: serviceRecord.category
            ? serviceRecord.category.toLowerCase().replace('_tv', '')
            : 'service',
          title: isElectricity
            ? `${provider || 'Electricity'} Bill`
            : `${category} Payment`,
          isDebit: true,
          token,
          meterNumber,
          customerName,
          provider,
          recipient: customerName || meterNumber || serviceRecord.recipientPhone || '—',
        },
      });
    }

    // 2. Fall back to general transaction ledger (transfers, funding, withdrawals)
    const txnRecord = await Transaction.findOne({ reference, userId }).lean();

    if (txnRecord) {
      return res.status(200).json({
        success: true,
        receipt: {
          ...txnRecord,
          receiptType: 'transaction',
          unifiedModule: txnRecord.type ? txnRecord.type.toLowerCase() : 'transfer',
          title: txnRecord.narration || `${txnRecord.type} Transaction`,
          isDebit: txnRecord.type === 'WITHDRAWAL' || txnRecord.type === 'TRANSFER',
          recipient: txnRecord.recipientName || txnRecord.recipientAccount || '—',
          token: null,
          meterNumber: null,
          customerName: txnRecord.recipientName || null,
        },
      });
    }

    // 3. Nothing found
    return res.status(404).json({
      success: false,
      message: "Receipt not found for the given reference.",
    });

  } catch (error) {
    console.error("Error fetching receipt:", error);
    return res.status(500).json({ success: false, message: "Error retrieving receipt." });
  }
};