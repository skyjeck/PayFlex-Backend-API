// utils/fxHelpers.js
import crypto from "crypto";

// Mock rate calculation (replace with external API call e.g., Fixer, ExchangeRate-API)
export const getExchangeRate = async (source, target) => {
  const rates = {
    USD_NGN: 1600,
    NGN_USD: 1 / 1600,
    EUR_NGN: 1750,
    NGN_EUR: 1 / 1750,
  };
  
  const pair = `${source.toUpperCase()}_${target.toUpperCase()}`;
  if (rates[pair]) return rates[pair];
  if (source.toUpperCase() === target.toUpperCase()) return 1;
  
  throw new Error(`Exchange rate pair ${pair} is not supported.`);
};

export const calculateFxFee = (amount) => {
  // Example: 0.5% fee
  return Number((amount * 0.005).toFixed(2));
};

export const generateFxRef = () => {
  return `FX_${Date.now()}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
};