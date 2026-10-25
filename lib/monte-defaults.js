function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

export function isEquityLikeSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  return Boolean(
    normalized
    && !normalized.startsWith("^")
    && !normalized.endsWith("-USD")
    && !normalized.endsWith("=X")
    && !normalized.endsWith("=F")
    && normalized !== "XAUUSD",
  );
}

/**
 * Build transparent defaults for any listed stock. Apple keeps the assumptions
 * validated in the original specification; every other stock receives a
 * conservative generic return mix with volatility scaled to its own history.
 * Earnings/P-E anchoring is automatic only when a positive market P/E exists.
 */
export function buildStockScenarioDefaults({
  symbol,
  historicalVolatility,
  latestVolatility,
  marketPE,
}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const validMarketPE = Number.isFinite(marketPE) && marketPE > 0 ? marketPE : null;
  const isApple = normalizedSymbol === "AAPL";

  if (isApple) {
    return {
      currentPE: validMarketPE || 28,
      peSource: validMarketPE ? "market" : "manual fallback",
      useFundamentalAnchor: true,
      profileLabel: "Validated AAPL profile",
      scenarios: [
        { id: "bear", label: "Bear", probability: 25, expectedReturn: 3, volatility: 32, epsGrowth: 3, epsVolatility: 6, targetPE: 22 },
        { id: "base", label: "Base", probability: 50, expectedReturn: 10, volatility: 26, epsGrowth: 9, epsVolatility: 5, targetPE: 28 },
        { id: "bull", label: "Bull", probability: 25, expectedReturn: 17, volatility: 29, epsGrowth: 14, epsVolatility: 6, targetPE: 34 },
      ],
    };
  }

  const longVolatility = Number.isFinite(historicalVolatility) ? historicalVolatility : 28;
  const recentVolatility = Number.isFinite(latestVolatility) ? latestVolatility : longVolatility;
  const blendedVolatility = clamp(longVolatility * 0.72 + recentVolatility * 0.28, 16, 55);
  const baseVolatility = roundHalf(clamp(blendedVolatility, 18, 48));
  const bearVolatility = roundHalf(clamp(Math.max(30, baseVolatility * 1.2), 25, 60));
  const bullVolatility = roundHalf(clamp(Math.max(24, baseVolatility * 1.05), 20, 55));
  const currentPE = validMarketPE || 24;
  const basePE = validMarketPE ? roundHalf(clamp(validMarketPE * 0.9, 12, 32)) : 24;
  const bearPE = roundHalf(clamp(basePE * 0.75, 8, 24));
  const bullPE = roundHalf(clamp(basePE * 1.2, 15, 40));
  const equityLike = isEquityLikeSymbol(normalizedSymbol);

  return {
    currentPE,
    peSource: validMarketPE ? "market" : "not supplied",
    useFundamentalAnchor: Boolean(equityLike && validMarketPE),
    profileLabel: equityLike ? "Adaptive stock profile" : "Adaptive price-only profile",
    scenarios: [
      { id: "bear", label: "Bear", probability: 25, expectedReturn: 1, volatility: bearVolatility, epsGrowth: 1, epsVolatility: 7, targetPE: bearPE },
      { id: "base", label: "Base", probability: 50, expectedReturn: 8, volatility: baseVolatility, epsGrowth: 7, epsVolatility: 6, targetPE: basePE },
      { id: "bull", label: "Bull", probability: 25, expectedReturn: 15, volatility: bullVolatility, epsGrowth: 12, epsVolatility: 8, targetPE: bullPE },
    ],
  };
}
