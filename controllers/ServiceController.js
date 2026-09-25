import axios from "axios";
import walletModel from "../models/WalletModel.js";
import transactionModel from "../models/TransactionModel.js";
import serviceTransactionModel from "../models/ServiceModel.js";
import userModel from "../models/UserModel.js";
import { createNotification } from "./NotificationController.js";

// Helper: Generate VTpass Compliant Request ID (Purely numeric, YYYYMMDDHHMMSS + Random)
const generateBillRef = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const randomDigits = Math.floor(1000 + Math.random() * 9000);

  return `${year}${month}${day}${hours}${minutes}${seconds}${randomDigits}`;
};

// VTpass Base Configuration
const VTPASS_BASE_URL = "https://sandbox.vtpass.com/api";

const getVtpassHeaders = () => {
  if (!process.env.VTPASS_API_KEY || !process.env.VTPASS_SECRET_KEY) {
    console.error("CRITICAL: VTPASS credentials missing from environment variables!");
  }
  return {
    "api-key": process.env.VTPASS_API_KEY,
    "secret-key": process.env.VTPASS_SECRET_KEY,
    "public-key": process.env.VTPASS_PUBLIC_KEY,
    "Content-Type": "application/json",
  };
};

// Provider Mappings
const VTPASS_SERVICE_IDS = {
  mtn: "mtn",
  airtel: "airtel",
  glo: "glo",
  "9mobile": "etisalat",
};

const VTPASS_CABLE_IDS = {
  dstv: "dstv",
  gotv: "gotv",
  startimes: "startimes",
  showmax: "showmax",
};

const VTPASS_ELECTRIC_IDS = {
  ikeja: "ikeja-electric",
  eko: "eko-electric",
  kano: "kano-electric",
  portharcourt: "portharcourt-electric",
  jos: "jos-electric",
  ibadan: "ibadan-electric",
  kaduna: "kaduna-electric",
  abuja: "abuja-electric",
  enugu: "enugu-electric",
  benin: "benin-electric",
  yola: "yola-electric",
};

// Mapping local provider keys to VTpass Service IDs
const ELECTRICITY_PROVIDERS = [
  { id: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)', serviceID: 'ikeja-electric' },
  { id: 'eko-electric', name: 'Eko Electric (EKEDC)', serviceID: 'eko-electric' },
  { id: 'kano-electric', name: 'Kano Electric (KEDCO)', serviceID: 'kano-electric' },
  { id: 'portharcourt-electric', name: 'Port Harcourt Electric (PHED)', serviceID: 'portharcourt-electric' },
  { id: 'jos-electric', name: 'Jos Electric (JED)', serviceID: 'jos-electric' },
  { id: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)', serviceID: 'ibadan-electric' },
  { id: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)', serviceID: 'kaduna-electric' },
  { id: 'enugu-electric', name: 'Enugu Electric (EEDC)', serviceID: 'enugu-electric' },
  { id: 'abuja-electric', name: 'Abuja Electric (AEDC)', serviceID: 'abuja-electric' }
];

// 1. GET /api/v1/services/airtime/providers
export const getAirtimeProviders = async (req, res) => {
  try {
    const NETWORK_PROVIDERS = [
      { id: "mtn", name: "MTN Nigeria", code: "MTN" },
      { id: "airtel", name: "Airtel Nigeria", code: "AIRTEL" },
      { id: "glo", name: "Glo Nigeria", code: "GLO" },
      { id: "9mobile", name: "9mobile", code: "9MOBILE" },
    ];

    return res.status(200).json({
      success: true,
      providers: NETWORK_PROVIDERS,
    });
  } catch (error) {
    console.error("Get Providers Error:", error);
    return res.status(500).json({ success: false, message: "Error fetching providers." });
  }
};

// 2. POST /api/v1/services/airtime/purchase
export const purchaseAirtime = async (req, res) => {
  try {
    const userId = req.userId;
    const { provider, phone, amount, pin } = req.body;

    if (!provider || !phone || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Provider, recipient phone number, and a valid amount are required.",
      });
    }

    // Optional: Add PIN validation if user model stores transaction PIN
    if (!pin) {
      return res.status(400).json({ success: false, message: "Transaction PIN is required." });
    }

    const serviceId = VTPASS_SERVICE_IDS[provider.toLowerCase()];
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid network provider." });
    }

    const wallet = await walletModel.findOne({ userId });
    if (!wallet || wallet.availableBalance < Number(amount)) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }

    const reference = generateBillRef();

    const vtpassPayload = {
      request_id: reference,
      serviceID: serviceId,
      amount: Number(amount),
      phone: phone,
    };

    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/pay`,
      vtpassPayload,
      { headers: getVtpassHeaders() }
    );

    const vtpassCode = vtpassRes.data?.code;
    const vtpassDesc = vtpassRes.data?.response_description;

    if (vtpassCode !== "000") {
      return res.status(400).json({
        success: false,
        message: vtpassDesc || "Airtime purchase failed at provider.",
        vtpass_code: vtpassCode,
      });
    }

    wallet.availableBalance -= Number(amount);
    wallet.ledgerBalance -= Number(amount);
    await wallet.save();

    await serviceTransactionModel.create({
      userId,
      category: "AIRTIME",
      provider: provider.toLowerCase(),
      recipientPhone: phone,
      amount: Number(amount),
      reference,
      status: "SUCCESS",
    });

    await transactionModel.create({
      userId,
      type: "WITHDRAWAL",
      amount: Number(amount),
      reference,
      narration: `${provider.toUpperCase()} Airtime Purchase for ${phone}`,
      status: "SUCCESS",
    });

    await createNotification(
      userId,
      "Airtime Purchase Successful",
      `Successfully purchased NGN ${amount} ${provider.toUpperCase()} Airtime for ${phone}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: `Successfully purchased NGN ${amount} ${provider.toUpperCase()} Airtime for ${phone}`,
      reference,
      newBalance: wallet.availableBalance,
    });
  } catch (error) {
    console.error("Airtime Purchase Error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Failed to process airtime purchase." });
  }
};

// 3. POST /api/v1/services/data/plans
export const getDataPlans = async (req, res) => {
  try {
    const provider = req.body?.provider || req.query?.provider;

    if (!provider) {
      return res.status(400).json({ 
        success: false, 
        message: "Provider is required (e.g. mtn, airtel, glo, 9mobile)." 
      });
    }

    const serviceId = VTPASS_SERVICE_IDS[provider.toLowerCase()] + "-data";

    const vtpassRes = await axios.get(
      `${VTPASS_BASE_URL}/service-variations?serviceID=${serviceId}`,
      { headers: getVtpassHeaders() }
    );

    if (vtpassRes.data.response_description !== "000") {
      return res.status(400).json({
        success: false,
        message: "Could not fetch data plans from provider.",
      });
    }

    const rawVariations = vtpassRes.data.content?.variations || vtpassRes.data.content?.varations || [];

    const plans = rawVariations.map((item) => ({
      planCode: item.variation_code,
      name: item.name,
      price: Number(item.variation_amount),
    }));

    return res.status(200).json({
      success: true,
      provider: provider.toLowerCase(),
      plans,
    });
  } catch (error) {
    console.error("Get Data Plans Error:", error?.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      message: "Error fetching data plans." 
    });
  }
};

// 4. POST /api/v1/services/data/purchase
export const purchaseData = async (req, res) => {
  try {
    const userId = req.userId;
    const { provider, phone, planCode, amount } = req.body;

    if (!provider || !phone || !planCode || !amount) {
      return res.status(400).json({
        success: false,
        message: "Provider, recipient phone number, planCode, and amount are required.",
      });
    }

    const serviceId = VTPASS_SERVICE_IDS[provider.toLowerCase()] + "-data";
    const wallet = await walletModel.findOne({ userId });

    if (!wallet || wallet.availableBalance < Number(amount)) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }

    const reference = generateBillRef();

    const vtpassPayload = {
      request_id: reference,
      serviceID: serviceId,
      billersCode: phone,
      variation_code: planCode,
      amount: Number(amount),
      phone: phone,
    };

    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/pay`,
      vtpassPayload,
      { headers: getVtpassHeaders() }
    );

    if (vtpassRes.data.code !== "000") {
      return res.status(400).json({
        success: false,
        message: vtpassRes.data.response_description || "Data purchase failed at provider.",
      });
    }

    wallet.availableBalance -= Number(amount);
    wallet.ledgerBalance -= Number(amount);
    await wallet.save();

    await serviceTransactionModel.create({
      userId,
      category: "DATA",
      provider: provider.toLowerCase(),
      recipientPhone: phone,
      amount: Number(amount),
      planCode,
      reference,
      status: "SUCCESS",
    });

    await transactionModel.create({
      userId,
      type: "WITHDRAWAL",
      amount: Number(amount),
      reference,
      narration: `${provider.toUpperCase()} Data Purchase for ${phone}`,
      status: "SUCCESS",
    });

    await createNotification(
      userId,
      "Data Purchase Successful",
      `Successfully activated data plan for ${phone}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: `Successfully activated data plan for ${phone}`,
      reference,
      newBalance: wallet.availableBalance,
    });
  } catch (error) {
    console.error("Data Purchase Error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Failed to process data purchase." });
  }
};

// 5. POST /api/v1/services/verify-customer

export const verifyCustomer = async (req, res) => {
  try {
    const serviceInput = req.body.service || req.body.provider;
    const customerId = req.body.customerId || req.body.meterNumber || req.body.smartcardNumber;
    const { type } = req.body;

    if (!serviceInput || !customerId) {
      return res.status(400).json({
        success: false,
        message: "Service provider and customer account ID are required.",
      });
    }

    // Convert e.g. "Ikeja Electric Disco" -> "ikeja"
    const rawInput = serviceInput.toLowerCase().trim();
    let serviceId = null;

    // Direct match against VTpass keys or mapped aliases
    for (const [alias, id] of Object.entries(VTPASS_ELECTRIC_IDS)) {
      if (rawInput.includes(alias)) {
        serviceId = id;
        break;
      }
    }

    // Fallback to Cable lookup if not found in Electric IDs
    if (!serviceId) {
      for (const [alias, id] of Object.entries(VTPASS_CABLE_IDS || {})) {
        if (rawInput.includes(alias)) {
          serviceId = id;
          break;
        }
      }
    }

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: `Invalid service provider: "${serviceInput}".`,
      });
    }

    const payload = {
      billersCode: customerId,
      serviceID: serviceId,
      type: (type || "prepaid").toLowerCase(),
    };

    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/merchant-verify`,
      payload,
      { headers: getVtpassHeaders() }
    );

    const content = vtpassRes.data?.content;
    const isSuccess = vtpassRes.data?.code === "000" || vtpassRes.data?.code === 0;

    if (!isSuccess || content?.error || (!content?.Customer_Name && !content?.Customer_Name_or_Details)) {
      return res.status(400).json({
        success: false,
        message: content?.error || vtpassRes.data?.response_description || "Customer verification failed.",
      });
    }

    return res.status(200).json({
      success: true,
      customerName: content.Customer_Name || content.Customer_Name_or_Details || "Verified Customer",
      accountDetails: content,
    });
  } catch (error) {
    console.error("Customer Verification Error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to verify customer ID.",
      error: error?.response?.data || error.message,
    });
  }
};

// 6. POST /api/v1/services/cable/packages
export const getCablePackages = async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ success: false, message: "Provider is required." });
    }

    const serviceId = VTPASS_CABLE_IDS[provider.toLowerCase()];
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid cable TV provider." });
    }

    const vtpassRes = await axios.get(
      `${VTPASS_BASE_URL}/service-variations?serviceID=${serviceId}`,
      { headers: getVtpassHeaders() }
    );

    const rawVariations = 
      vtpassRes.data.content?.variations || 
      vtpassRes.data.content?.varations || 
      [];

    const packages = rawVariations.map((item) => ({
      packageCode: item.variation_code,
      name: item.name,
      price: Number(item.variation_amount),
    }));

    return res.status(200).json({ success: true, provider, packages });
  } catch (error) {
    console.error("Get Cable Packages Error:", error?.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      message: "Error fetching cable packages.",
      error: error?.response?.data || error.message 
    });
  }
};

// 7. POST /api/v1/services/cable/purchase
export const purchaseCableTV = async (req, res) => {
  try {
    console.log("📥 Incoming Request Body:", req.body);

    const userId = req.userId;
    
    // Support both smartcardNumber (lowercase c) and smartCardNumber (camelCase C)
    const provider = req.body.provider;
    const smartcardNumber = req.body.smartcardNumber || req.body.smartCardNumber;
    const packageCode = req.body.packageCode || req.body.package;
    const amount = req.body.amount;
    const phone = req.body.phone;
    const pin = req.body.pin;
    const subscriptionType = req.body.subscriptionType || "change";

    // Debug log to see exactly which variable fails
    if (!provider) console.log("❌ Missing provider");
    if (!smartcardNumber) console.log("❌ Missing smartcardNumber");
    if (!packageCode) console.log("❌ Missing packageCode");
    if (amount === undefined || amount === null) console.log("❌ Missing amount");
    if (!phone) console.log("❌ Missing phone");

    if (!provider || !smartcardNumber || !packageCode || amount === undefined || amount === null || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: "All purchase fields are required." 
      });
    }

    const serviceId = VTPASS_CABLE_IDS[provider.toLowerCase()];
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid cable TV provider." });
    }

    const wallet = await walletModel.findOne({ userId });
    if (!wallet || wallet.availableBalance < Number(amount)) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }

    const reference = generateBillRef();

    const vtpassPayload = {
      request_id: reference,
      serviceID: serviceId,
      billersCode: smartcardNumber,
      variation_code: packageCode,
      amount: Number(amount),
      phone: phone,
      subscription_type: subscriptionType,
    };

    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/pay`, 
      vtpassPayload, 
      { headers: getVtpassHeaders() }
    );

    console.log("VTpass TV Purchase Response:", JSON.stringify(vtpassRes.data, null, 2));

    if (vtpassRes.data.code !== "000") {
      return res.status(400).json({
        success: false,
        message: vtpassRes.data.response_description || "TV subscription payment failed.",
        vtpass_code: vtpassRes.data.code,
        vtpass_details: vtpassRes.data,
      });
    }

    // Debit Wallet
    wallet.availableBalance -= Number(amount);
    wallet.ledgerBalance -= Number(amount);
    await wallet.save();

    // Log Utility Purchase
    await serviceTransactionModel.create({
      userId,
      category: "CABLE_TV",
      provider: provider.toLowerCase(),
      recipientPhone: phone,
      amount: Number(amount),
      planCode: packageCode,
      reference,
      status: "SUCCESS",
    });

    // Log General Ledger Transaction
    await transactionModel.create({
      userId,
      type: "WITHDRAWAL",
      amount: Number(amount),
      reference,
      narration: `${provider.toUpperCase()} TV Subscription for ${smartcardNumber}`,
      status: "SUCCESS",
    });

    await createNotification(
      userId,
      "Cable TV Subscription Successful",
      `Successfully paid ${provider.toUpperCase()} subscription for ${smartcardNumber}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: `Successfully paid ${provider.toUpperCase()} subscription.`,
      reference,
      newBalance: wallet.availableBalance,
    });
  } catch (error) {
    console.error("Cable TV Purchase Full Error:", error?.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to process TV subscription.",
      error: error?.response?.data || error.message 
    });
  }
};

export const getElectricityProviders = async (req, res) => {
  try {
    // Optionally fetch dynamic status/services from VTpass
    const response = await axios.get(
      `${VTPASS_BASE_URL}/api/services?identifier=electricity-bill`,
      {
        headers: {
          'api-key': process.env.VTPASS_API_KEY,
          'public-key': process.env.VTPASS_PUBLIC_KEY
        }
      }
    );

    const apiProviders = response.data?.content || [];

    // Fallback to internal list if external API response body is empty
    const providersList = apiProviders.length > 0 
      ? apiProviders.map((item) => ({
          id: item.serviceID,
          name: item.name,
          serviceID: item.serviceID
        }))
      : ELECTRICITY_PROVIDERS;

    return res.status(200).json({
      success: true,
      message: 'Electricity providers fetched successfully',
      providers: providersList,
      data: providersList
    });
  } catch (error) {
    // Fallback gracefully on network error during local development
    return res.status(200).json({
      success: true,
      message: 'Electricity providers loaded from local fallback',
      providers: ELECTRICITY_PROVIDERS,
      data: ELECTRICITY_PROVIDERS
    });
  }
};

// 8. POST /api/v1/services/electricity/purchase

export const purchaseElectricity = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id || req.user?.id;
    const { provider, meterNumber, meterType, amount, phone, pin } = req.body;

    // 1. Validate required fields
    if (!provider || !meterNumber || !meterType || !amount || !phone || !pin) {
      return res.status(400).json({
        success: false,
        message: "All fields (provider, meterNumber, meterType, amount, phone, pin) are required.",
      });
    }

    // 2. Fetch user and explicitly request select: false transactionPin
    const user = await userModel.findById(userId).select("+transactionPin");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    // 3. Verify transaction PIN setup & match
    if (!user.transactionPin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN not set. Please setup your PIN first.",
      });
    }

    const isPinValid = await user.comparePin(pin);
    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        message: "Incorrect transaction PIN.",
      });
    }

    // 4. Verify provider service mapping
    const serviceId = VTPASS_ELECTRIC_IDS[provider.toLowerCase()];
    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "Invalid electricity provider.",
      });
    }

    // 5. Check wallet balance
    const wallet = await walletModel.findOne({ userId });
    if (!wallet || wallet.availableBalance < Number(amount)) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
      });
    }

    const reference = generateBillRef();

    // 6. Execute VTPass Payment
    const vtpassPayload = {
      request_id: reference,
      serviceID: serviceId,
      billersCode: meterNumber,
      variation_code: meterType.toLowerCase(),
      amount: Number(amount),
      phone: phone,
    };

    const vtpassRes = await axios.post(`${VTPASS_BASE_URL}/pay`, vtpassPayload, {
      headers: getVtpassHeaders(),
    });

    if (vtpassRes.data.code !== "000") {
      return res.status(400).json({
        success: false,
        message: vtpassRes.data.response_description || "Electricity bill payment failed.",
      });
    }

    console.log("⚡ VTPass Electricity Response:", JSON.stringify(vtpassRes.data, null, 2));

    // VTPass returns the electricity token nested inside content.transactions
    // Covers: token, purchased_code, Token (case variant) across known response shapes
    const txnContent = vtpassRes.data?.content?.transactions;
    const generatedToken =
      txnContent?.token ||
      txnContent?.purchased_code ||
      txnContent?.Token ||
      vtpassRes.data?.token ||
      vtpassRes.data?.purchased_code ||
      null;

    // Extract customer name from VTPass response (varies by provider)
    const vtpassCustomerName =
      vtpassRes.data.content?.transactions?.name ||
      vtpassRes.data.content?.transactions?.customer_name ||
      vtpassRes.data.content?.Customer_Name ||
      null;

    // 7. Debit wallet
    wallet.availableBalance -= Number(amount);
    wallet.ledgerBalance -= Number(amount);
    await wallet.save();

    // 8. Record transaction history — persist electricity-specific fields for receipt
    await serviceTransactionModel.create({
      userId,
      category: "ELECTRICITY",
      provider: provider.toLowerCase(),
      recipientPhone: phone,
      amount: Number(amount),
      reference,
      status: "SUCCESS",
      token: generatedToken,        // prepaid electricity token
      meterNumber,                  // meter number used
      meterType: meterType.toLowerCase(), // "prepaid" | "postpaid"
      customerName: vtpassCustomerName,   // customer name from VTPass
    });

    await transactionModel.create({
      userId,
      type: "WITHDRAWAL",
      amount: Number(amount),
      reference,
      narration: `${provider.toUpperCase()} Electricity Bill for Meter ${meterNumber}`,
      status: "SUCCESS",
    });

    await createNotification(
      userId,
      "Electricity Token Generated",
      `Successfully purchased electricity token for meter ${meterNumber}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: `Successfully purchased electricity bill for ${meterNumber}`,
      token: generatedToken,
      reference,
      newBalance: wallet.availableBalance,
    });

  } catch (error) {
    console.error("Electricity Purchase Error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process electricity purchase.",
    });
  }
};

// GET /api/v1/services/history
export const getServiceHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, category } = req.query;

    // Filter by user and optionally by category (AIRTIME, DATA, CABLE_TV, ELECTRICITY)
    const filter = { userId };
    if (category) {
      filter.category = category.toUpperCase();
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      serviceTransactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      serviceTransactionModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
      transactions,
    });
  } catch (error) {
    console.error("Fetch Utility History Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve utility transaction history.",
    });
  }
};


// GET /api/v1/services/transaction/:reference
export const getServiceByReference = async (req, res) => {
  try {
    const userId = req.userId;
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Transaction reference is required.",
      });
    }

    // Ensure transaction exists AND belongs to the authenticated user
    const transaction = await serviceTransactionModel
      .findOne({ reference, userId })
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found.",
      });
    }

    return res.status(200).json({
      success: true,
      transaction,
    });
  } catch (error) {
    console.error("Fetch Single Transaction Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve transaction details.",
    });
  }
};


// Append to VTPASS_SERVICE_IDS or add VTPASS_BETTING_IDS
const VTPASS_BETTING_IDS = {
  sportybet: "sportybet",
  bet9ja: "bet9ja",
  "1xbet": "1xbet",
  naijabet: "naijabet",
  bangbet: "bangbet",
  betway: "betway",
  merrybet: "merrybet",
  betking: "betking",
  livescorebet: "livescorebet",
  parimatch: "parimatch",
};

/**
 * @route POST /api/services/betting/verify
 * @desc Verify Customer Betting Account ID
 */

// GET /api/v1/services/betting/providers
export const getBettingProviders = async (req, res) => {
  const STATIC_BETTING_PROVIDERS = [
    { id: "bet9ja", name: "Bet9ja", code: "BET9JA" },
    { id: "sportybet", name: "SportyBet", code: "SPORTYBET" },
    { id: "1xbet", name: "1xBet", code: "1XBET" },
    { id: "bangbet", name: "BangBet", code: "BANGBET" },
    { id: "nairabet", name: "NairaBet", code: "NAIRABET" },
    { id: "merrybet", name: "MerryBet", code: "MERRYBET" },
    { id: "betway", name: "Betway", code: "BETWAY" },
  ];

  try {
    // 1. Try Live API Fetch First
    const vtpassRes = await axios.get(
      `${VTPASS_BASE_URL}/services?identifier=other-services`,
      { headers: getVtpassHeaders() }
    );

    const rawServices = vtpassRes.data?.content;

    // 2. Filter betting-related services if live response returns valid array
    if (
      vtpassRes.data?.response_description === "000" &&
      Array.isArray(rawServices) &&
      rawServices.length > 0
    ) {
      const liveProviders = rawServices
        .filter((item) => item.serviceID.includes("bet") || item.name.toLowerCase().includes("bet"))
        .map((item) => ({
          id: item.serviceID,
          name: item.name,
          code: item.serviceID.toUpperCase(),
          minAmount: Number(item.minimium_amount || 100),
          maxAmount: Number(item.maximum_amount || 500000),
          image: item.image || null,
        }));

      if (liveProviders.length > 0) {
        return res.status(200).json({
          success: true,
          isLive: true,
          providers: liveProviders,
        });
      }
    }

    // 3. Graceful Fallback if Live response had no match / empty
    return res.status(200).json({
      success: true,
      isLive: false,
      providers: STATIC_BETTING_PROVIDERS,
    });
  } catch (error) {
    // 4. Fallback in case of Network failure or Sandbox environment error
    console.warn("Live API fetch failed, serving static betting list.");
    return res.status(200).json({
      success: true,
      isLive: false,
      providers: STATIC_BETTING_PROVIDERS,
    });
  }
};

// Inside verifyBettingCustomer
export const verifyBettingCustomer = async (req, res) => {
  try {
    const serviceInput = req.body.provider || req.body.service;
    const customerId = req.body.customerId || req.body.customer_id;

    console.log("📥 Verification Request Body:", req.body);

    if (!serviceInput || !customerId) {
      return res.status(400).json({
        success: false,
        message: "Provider and customerId are required.",
      });
    }

    const cleanKey = serviceInput.toString().toLowerCase().trim();
    const serviceId = VTPASS_BETTING_IDS[cleanKey] || cleanKey;

    const vtpassPayload = {
      billersCode: customerId.toString().trim(),
      serviceID: serviceId,
    };

    console.log("📡 Sending to VTpass:", vtpassPayload);

    const baseUrl = process.env.VTPASS_BASE_URL || VTPASS_BASE_URL;

    const vtpassRes = await axios.post(
      `${baseUrl}/merchant-verify`,
      vtpassPayload,
      { headers: getVtpassHeaders() }
    );

    console.log("📩 VTpass Verification Response:", JSON.stringify(vtpassRes.data, null, 2));

    const code = vtpassRes.data?.code;
    const content = vtpassRes.data?.content;
    const isSuccess = code === "000" || code === 0 || code === "00";

    // Extract customer name across VTpass response variants
    const realCustomerName =
      content?.Customer_Name ||
      content?.Customer_Name_or_Details ||
      content?.name ||
      content?.user?.name ||
      content?.user ||
      content?.username;

    // Sandbox Fallback: Bypass code 012 in non-production environments for local UI testing
    const isSandbox = baseUrl.includes("sandbox");
    if ((code === "012" || !isSuccess) && isSandbox) {
      console.warn(`⚠️ VTpass Sandbox returned code ${code}. Returning mock customer verification for testing.`);
      
      return res.status(200).json({
        success: true,
        message: "Customer verified (Sandbox Mock).",
        customerName: "TEST USER (BETTING)",
        accountDetails: {
          Customer_Name: "TEST USER (BETTING)",
          Customer_ID: customerId,
          Provider: serviceInput,
          ...content,
        },
      });
    }

    // Production Validation Check
    if (!isSuccess || content?.error || !realCustomerName) {
      return res.status(400).json({
        success: false,
        message:
          content?.error ||
          vtpassRes.data?.response_description ||
          "Invalid Customer ID or betting account verification failed.",
        vtpass_code: code,
        vtpass_details: vtpassRes.data,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Customer verified successfully.",
      customerName: realCustomerName,
      accountDetails: content,
    });
  } catch (error) {
    console.error(
      "Betting Verification Error:",
      error?.response?.data || error.message
    );

    // Fallback if VTpass sandbox times out or errors during development
    const baseUrl = process.env.VTPASS_BASE_URL || VTPASS_BASE_URL;
    if (baseUrl.includes("sandbox")) {
      return res.status(200).json({
        success: true,
        message: "Customer verified (Sandbox Exception Mock).",
        customerName: "TEST USER (BETTING)",
        accountDetails: { Customer_Name: "TEST USER (BETTING)" },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to verify betting customer ID.",
      error: error?.response?.data || error.message,
    });
  }
};

// 11. POST /api/v1/services/betting/fund
export const fundBettingWallet = async (req, res) => {
  try {
    const userId = req.userId;
    const { provider, customerId, amount, phone, pin } = req.body;

    console.log("📥 Incoming Betting Fund Request:", {
      userId,
      provider,
      customerId,
      amount,
      phone,
    });

    // 1. Validation Guard
    if (!provider || !customerId || amount === undefined || amount === null || !phone || !pin) {
      return res.status(400).json({
        success: false,
        message: "All fields (provider, customerId, amount, phone, pin) are required.",
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid funding amount.",
      });
    }

    const cleanProvider = provider.toString().toLowerCase().trim();
    const serviceId = VTPASS_BETTING_IDS[cleanProvider] || cleanProvider;

    // 2. PIN Verification
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.pin && user.pin !== pin) {
      return res.status(400).json({ success: false, message: "Invalid transaction PIN." });
    }

    // 3. Wallet Balance Guard
    const wallet = await walletModel.findOne({ userId });
    if (!wallet || wallet.availableBalance < numericAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
      });
    }

    // 4. Send Request to VTpass
    const requestId = generateBillRef();
    const vtpassPayload = {
      request_id: requestId,
      serviceID: serviceId,
      billersCode: customerId.toString().trim(),
      amount: numericAmount,
      phone: phone.toString().trim(),
    };

    console.log("📡 Sending Top-Up Request to VTpass:", vtpassPayload);

    const baseUrl = process.env.VTPASS_BASE_URL || VTPASS_BASE_URL;
    let isSuccess = false;
    let vtpassCode = null;

    try {
      const vtpassRes = await axios.post(
        `${baseUrl}/pay`,
        vtpassPayload,
        { headers: getVtpassHeaders() }
      );

      console.log("📩 VTpass Top-Up Response:", JSON.stringify(vtpassRes.data, null, 2));
      vtpassCode = vtpassRes.data?.code;
      isSuccess = vtpassCode === "000" || vtpassCode === 0 || vtpassCode === "00";
    } catch (apiErr) {
      console.error("VTpass API Network Error:", apiErr?.response?.data || apiErr.message);
    }

    // Sandbox Mock Fallback
    const isSandbox = baseUrl.includes("sandbox");
    if (!isSuccess && isSandbox) {
      console.warn(`⚠️ VTpass Sandbox returned code ${vtpassCode || "ERROR"}. Simulating successful transaction for local testing.`);
      isSuccess = true;
    }

    if (!isSuccess) {
      let errorMessage = "Betting wallet funding failed.";
      if (vtpassCode === "016") {
        errorMessage = "Invalid Customer ID or account rejected by provider.";
      }

      return res.status(400).json({
        success: false,
        message: errorMessage,
        vtpass_code: vtpassCode,
      });
    }

    // 5. Debit Local Wallet
    wallet.availableBalance -= numericAmount;
    wallet.ledgerBalance -= numericAmount;
    await wallet.save();

    // 6. Log Single Unified Transaction Record (Uses ONLY transactionModel)
    await transactionModel.create({
      userId,
      type: "WITHDRAWAL", // Or "BILL_PAYMENT" if updated in your schema enum
      amount: numericAmount,
      reference: requestId,
      recipientAccount: customerId,
      recipientName: `${cleanProvider.toUpperCase()} Account`,
      narration: `${cleanProvider.toUpperCase()} Topup for ID ${customerId}`,
      status: "SUCCESS",
    });

    await createNotification(
      userId,
      "Betting Wallet Funded",
      `Successfully funded ${cleanProvider.toUpperCase()} account (${customerId}) with NGN ${numericAmount}.`,
      "TRANSACTION"
    );

    return res.status(200).json({
      success: true,
      message: `Successfully funded ${cleanProvider.toUpperCase()} account.`,
      reference: requestId,
      newBalance: wallet.availableBalance,
    });
  } catch (error) {
    console.error("Betting Funding Controller Error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process betting wallet funding.",
      error: error?.response?.data || error.message,
    });
  }
};

// Mock database for Cable TV Providers & Packages
const CABLE_DATA = [
  {
    id: 'dstv',
    name: 'DStv',
    code: 'DSTV',
    logo: '/images/providers/dstv.png',
    packages: [
      { id: 'dstv-padi', code: 'dstv-padi', name: 'DStv Padi', price: 3900, period: '1 Month' },
      { id: 'dstv-yanga', code: 'dstv-yanga', name: 'DStv Yanga', price: 5100, period: '1 Month' },
      { id: 'dstv-confam', code: 'dstv-confam', name: 'DStv Confam', price: 9300, period: '1 Month' },
      { id: 'dstv-compact', code: 'dstv-compact', name: 'DStv Compact', price: 15700, priceFormatted: '15,700', period: '1 Month' },
      { id: 'dstv-compact-plus', code: 'dstv-compact-plus', name: 'DStv Compact Plus', price: 25000, period: '1 Month' },
      { id: 'dstv-premium', code: 'dstv-premium', name: 'DStv Premium', price: 37000, period: '1 Month' }
    ]
  },
  {
    id: 'gotv',
    name: 'GOtv',
    code: 'GOTV',
    logo: '/images/providers/gotv.png',
    packages: [
      { id: 'gotv-smallie', code: 'gotv-smallie', name: 'GOtv Smallie', price: 1500, period: '1 Month' },
      { id: 'gotv-jinja', code: 'gotv-jinja', name: 'GOtv Jinja', price: 3300, period: '1 Month' },
      { id: 'gotv-jolli', code: 'gotv-jolli', name: 'GOtv Jolli', price: 4850, period: '1 Month' },
      { id: 'gotv-max', code: 'gotv-max', name: 'GOtv Max', price: 7200, period: '1 Month' },
      { id: 'gotv-supa', code: 'gotv-supa', name: 'GOtv Supa', price: 9600, period: '1 Month' },
      { id: 'gotv-supa-plus', code: 'gotv-supa-plus', name: 'GOtv Supa Plus', price: 15700, period: '1 Month' }
    ]
  },
  {
    id: 'startimes',
    name: 'StarTimes',
    code: 'STARTIMES',
    logo: '/images/providers/startimes.png',
    packages: [
      { id: 'startimes-nova', code: 'nova', name: 'StarTimes Nova', price: 1500, period: '1 Month' },
      { id: 'startimes-basic', code: 'basic', name: 'StarTimes Basic', price: 3000, period: '1 Month' },
      { id: 'startimes-smart', code: 'smart', name: 'StarTimes Smart', price: 3800, period: '1 Month' },
      { id: 'startimes-classic', code: 'classic', name: 'StarTimes Classic', price: 5000, period: '1 Month' },
      { id: 'startimes-super', code: 'super', name: 'StarTimes Super', price: 7000, period: '1 Month' }
    ]
  },
  {
    id: 'showmax',
    name: 'Showmax',
    code: 'SHOWMAX',
    logo: '/images/providers/showmax.png',
    packages: [
      { id: 'showmax-entertainment', code: 'showmax-ent', name: 'Entertainment Mobile', price: 1600, period: '1 Month' },
      { id: 'showmax-pl-mobile', code: 'showmax-pl', name: 'Premier League Mobile', price: 2900, period: '1 Month' },
      { id: 'showmax-all-mobile', code: 'showmax-all', name: 'Entertainment + PL Mobile', price: 3600, period: '1 Month' }
    ]
  }
];

// GET: /api/services/cable/providers

export const getAllCable = async (req, res) => {
  try {
    const providerKeys = Object.keys(VTPASS_CABLE_IDS);

    // Fetch variations for each cable provider concurrently
    const cableData = await Promise.all(
      providerKeys.map(async (key) => {
        const serviceID = VTPASS_CABLE_IDS[key];

        try {
          const response = await axios.get(
            `${VTPASS_BASE_URL}/api/service-variations?serviceID=${serviceID}`,
            {
              headers: {
                'api-key': process.env.VTPASS_API_KEY,
                'public-key': process.env.VTPASS_PUBLIC_KEY
              }
            }
          );

          // Correct spelling: variations (not varations)
          const content = response.data?.content;
          const variations = content?.variations || content?.varations || [];

          return {
            id: key,
            name: content?.ServiceName || key.toUpperCase(),
            serviceID,
            packages: variations.map((item) => ({
              code: item.variation_code,
              name: item.name,
              price: Number(item.variation_amount),
              fixedPrice: item.fixedPrice
            }))
          };
        } catch (err) {
          // Fallback if one provider call fails
          return {
            id: key,
            name: key.toUpperCase(),
            serviceID,
            packages: []
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Cable providers and packages retrieved successfully',
      providers: cableData.map(({ packages, ...provider }) => provider), // Light provider list
      data: cableData // Complete list with packages
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error fetching cable services'
    });
  }
};

// POST: /api/services/cable/verify
export const verifySmartcard = async (req, res) => {
  try {
    const { provider, smartcardNumber } = req.body;

    if (!provider || !smartcardNumber) {
      return res.status(400).json({
        success: false,
        message: 'Provider and smartcardNumber are required'
      });
    }

    // Mock validation - Replace with real VTU API integration (e.g., VTPass, Clubkonnect)
    return res.status(200).json({
      success: true,
      data: {
        customerName: 'STEPHEN ENEMCHUKWU',
        smartcardNumber,
        provider,
        currentBouquet: 'DStv Compact',
        dueDate: '2026-10-15'
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyMeter = async (req, res) => {
  try {
    // Support both meterNumber and customerId from req.body
    const { provider, meterNumber, customerId, type } = req.body;
    const billersCode = meterNumber || customerId;

    if (!provider || !billersCode) {
      return res.status(400).json({
        success: false,
        message: "Provider and meter number are required for verification.",
      });
    }

    const serviceId = VTPASS_ELECTRIC_IDS[provider.toLowerCase()];
    if (!serviceId) {
      return res.status(400).json({ success: false, message: "Invalid electricity provider." });
    }

    // Call VTPass merchant-verify endpoint
    const vtpassRes = await axios.post(
      `${VTPASS_BASE_URL}/merchant-verify`,
      {
        serviceID: serviceId,
        billersCode: billersCode,
        type: (type || "prepaid").toLowerCase(),
      },
      { headers: getVtpassHeaders() }
    );

    if (vtpassRes.data.code !== "000") {
      return res.status(400).json({
        success: false,
        message: vtpassRes.data.response_description || "Customer verification failed.",
      });
    }

    const customerDetails = vtpassRes.data.content;

    return res.status(200).json({
      success: true,
      data: {
        customerName: customerDetails.Customer_Name,
        meterNumber: customerDetails.Meter_Number || billersCode,
        address: customerDetails.Address,
        dueDate: customerDetails.DueDate,
      },
    });
  } catch (error) {
    console.error("Meter Verification Error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Failed to verify meter details." });
  }
};