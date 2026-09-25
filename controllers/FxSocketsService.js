import { getClientFxRate } from "../controllers/FxRateService.js";

export const initFxRateBroadcaster = (io) => {
  // Broadcast live rates every 10 seconds
  setInterval(async () => {
    try {
      const currencies = ["USD", "EUR", "GBP"];
      const rates = {};

      for (const curr of currencies) {
        const { clientRate } = await getClientFxRate(curr, "NGN");
        rates[`${curr}_NGN`] = clientRate;
      }

      // Push rate ticks to all connected WebSocket clients
      io.emit("fx_rates_tick", {
        timestamp: Date.now(),
        base: "NGN",
        rates,
      });
    } catch (err) {
      console.error("Rate broadcast error:", err.message);
    }
  }, 10000);
};