import assert from "node:assert/strict";
import test from "node:test";
import { buildStockScenarioDefaults, isEquityLikeSymbol } from "../lib/monte-defaults.js";

test("AAPL retains the validated specification defaults", () => {
  const profile = buildStockScenarioDefaults({
    symbol: "AAPL",
    historicalVolatility: 41,
    latestVolatility: 52,
    marketPE: null,
  });
  assert.equal(profile.profileLabel, "Validated AAPL profile");
  assert.equal(profile.currentPE, 28);
  assert.equal(profile.useFundamentalAnchor, true);
  assert.deepEqual(profile.scenarios.map((item) => [item.probability, item.expectedReturn, item.volatility, item.epsGrowth, item.targetPE]), [
    [25, 3, 32, 3, 22],
    [50, 10, 26, 9, 28],
    [25, 17, 29, 14, 34],
  ]);
});

test("other stocks adapt volatility and valuation to their own inputs", () => {
  const profile = buildStockScenarioDefaults({
    symbol: "MSFT",
    historicalVolatility: 30,
    latestVolatility: 40,
    marketPE: 30,
  });
  assert.equal(profile.profileLabel, "Adaptive stock profile");
  assert.equal(profile.currentPE, 30);
  assert.equal(profile.peSource, "market");
  assert.equal(profile.useFundamentalAnchor, true);
  assert.equal(profile.scenarios[1].volatility, 33);
  assert.equal(profile.scenarios[1].targetPE, 27);
  assert.deepEqual(profile.scenarios.map((item) => item.expectedReturn), [1, 8, 15]);
});

test("stocks without a positive market P/E do not invent an earnings anchor", () => {
  const profile = buildStockScenarioDefaults({
    symbol: "TSLA",
    historicalVolatility: 62,
    latestVolatility: 75,
    marketPE: null,
  });
  assert.equal(profile.peSource, "not supplied");
  assert.equal(profile.useFundamentalAnchor, false);
  assert.equal(profile.scenarios[1].volatility, 48);
});

test("indexes, forex, futures and crypto remain price-only profiles", () => {
  assert.equal(isEquityLikeSymbol("MSFT"), true);
  assert.equal(isEquityLikeSymbol("NPN.JO"), true);
  assert.equal(isEquityLikeSymbol("^GSPC"), false);
  assert.equal(isEquityLikeSymbol("EURUSD=X"), false);
  assert.equal(isEquityLikeSymbol("GC=F"), false);
  assert.equal(isEquityLikeSymbol("BTC-USD"), false);
});
