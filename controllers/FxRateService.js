import axios from "axios";

const PLATFORM_MARGIN_PERCENT = 1.5; // 1.5% platform spread
const CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute cache

// Per-currency cache isolation
const cache = new Map();

/**
 * Fetch live exchange rates directly from the open public API (No key required)
 */
export const getLiveFxRates = async (baseCurrency = "USD") => {
  const base = baseCurrency.toUpperCase();
  const now = Date.now();

  // Return cached rates if valid
  const cachedData = cache.get(base);
  if (cachedData && cachedData.expiry > now) {
    return {
      baseCurrency: base,
      rates: cachedData.rates,
      source: "live_cache",
    };
  }

  // Keyless open endpoint
  const response = await axios.get(
    `https://open.er-api.com/v6/latest/${base}`,
    { timeout: 7000 }
  );

  if (response.data?.result !== "success" || !response.data?.rates) {
    const errorType = response.data?.["error-type"] || "Unknown provider error";
    throw new Error(`FX Provider Error: ${errorType}`);
  }

  const rates = response.data.rates;
  cache.set(base, { rates, expiry: now + CACHE_TTL_MS });

  return {
    baseCurrency: base,
    rates,
    source: "live",
  };
};

/**
 * Get raw live market rate between two currencies
 */
export const getBaseMarketRate = async (baseCurrency, targetCurrency) => {
  const base = baseCurrency.toUpperCase();
  const target = targetCurrency.toUpperCase();

  if (base === target) return 1.0;

  const liveData = await getLiveFxRates(base);
  const rate = liveData.rates[target];

  if (!rate) {
    throw new Error(`Live rate not available for pair ${base}/${target}`);
  }

  return rate;
};

/**
 * Calculate live rate with platform spread applied
 */
export const getClientFxRate = async (fromCurrency, toCurrency, direction = "payout") => {
  const baseRate = await getBaseMarketRate(fromCurrency, toCurrency);

  const marginMultiplier =
    direction === "payout"
      ? 1 - PLATFORM_MARGIN_PERCENT / 100
      : 1 + PLATFORM_MARGIN_PERCENT / 100;

  const clientRate = baseRate * marginMultiplier;

  return {
    rawRate: baseRate,
    clientRate: Number(clientRate.toPrecision(8)),
    marginPercent: PLATFORM_MARGIN_PERCENT,
  };
};