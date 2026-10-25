import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CSV_COLUMNS,
  annualToDailyLogDrift,
  annualToDailyVolatility,
  createSeededRandom,
  fundamentalWeight,
  meanRevertingPE,
  medianCagr,
  percentileSorted,
  runSimulation,
  selectScenarioIndex,
} from "../public/monte-carlo-engine.js";
import { buildStockScenarioDefaults } from "../lib/monte-defaults.js";

const historicalPack = JSON.parse(
  readFileSync(new URL("../data/monte-carlo-historical-pack.json", import.meta.url), "utf8"),
);
const apple = historicalPack.profiles.APPLE;

const defaultScenarios = [
  { id: "bear", probability: .25, expectedReturn: .03, volatility: .32, epsGrowth: .03, epsVolatility: .06, targetPE: 22 },
  { id: "base", probability: .50, expectedReturn: .10, volatility: .26, epsGrowth: .09, epsVolatility: .05, targetPE: 28 },
  { id: "bull", probability: .25, expectedReturn: .17, volatility: .29, epsGrowth: .14, epsVolatility: .06, targetPE: 34 },
];

function input(overrides = {}) {
  return {
    requestId: "regression",
    startingPrice: 308.91,
    targetPrice: 400,
    horizon: 63,
    simulations: 20000,
    modelMode: "realistic",
    scenarios: defaultScenarios,
    historicalReturns: apple.logReturns.slice(-1260),
    returnRegimes: apple.volatilityRegimes.slice(-1260),
    currentVolatilityRegime: apple.currentVolatilityRegime,
    historicalAnnualReturn: apple.annualizedReturn / 100,
    periodsPerYear: 252,
    seed: 20260802,
    regime: "balanced",
    currentPE: 28,
    meanReversionSpeed: .55,
    fatTails: true,
    degreesOfFreedom: 6,
    jumpRisk: true,
    annualJumpProbability: .25,
    ...overrides,
  };
}

test("annual assumptions convert to corrected daily GBM inputs", () => {
  const drift = annualToDailyLogDrift(.10, .26, 252);
  assert.ok(Math.abs(drift - (Math.log(1.10) - .5 * .26 ** 2) / 252) < 1e-14);
  assert.ok(Math.abs(annualToDailyVolatility(.26, 252) - .26 / Math.sqrt(252)) < 1e-14);
});

test("scenario selection follows the configured mixture", () => {
  const random = createSeededRandom(77);
  const counts = [0, 0, 0];
  for (let index = 0; index < 100000; index += 1) {
    counts[selectScenarioIndex(random(), defaultScenarios)] += 1;
  }
  assert.ok(Math.abs(counts[0] / 100000 - .25) < .01);
  assert.ok(Math.abs(counts[1] / 100000 - .50) < .01);
  assert.ok(Math.abs(counts[2] / 100000 - .25) < .01);
});

test("percentiles, P/E reversion, fundamental weighting and CAGR are correct", () => {
  assert.equal(percentileSorted([1, 2, 3, 4, 5], .5), 3);
  assert.equal(percentileSorted([1, 2, 3, 4], .25), 1.75);
  assert.equal(meanRevertingPE(36, 28, 0, 5), 36);
  assert.ok(meanRevertingPE(36, 28, .55, 5) > 28);
  assert.ok(meanRevertingPE(36, 28, .55, 5) < 29);
  assert.equal(fundamentalWeight(0), 0);
  assert.ok(fundamentalWeight(1) > 0 && fundamentalWeight(1) < .5);
  assert.equal(fundamentalWeight(3), 1);
  assert.ok(Math.abs(medianCagr(100, 121, 504, 252) - .10) < 1e-12);
});

test("fixed seed is reproducible and outputs remain finite and positive", () => {
  const first = runSimulation(input({ simulations: 2000 }));
  const second = runSimulation(input({ simulations: 2000 }));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  for (const series of [first.outerLow, first.p25, first.median, first.p75, first.outerHigh]) {
    assert.equal(series.length, 64);
    assert.ok(series.every((value) => Number.isFinite(value) && value > 0));
  }
  assert.equal(first.tradingDays, 63);
  assert.equal(first.simulations, 2000);
});

test("CSV schema remains backward compatible", () => {
  assert.deepEqual(CSV_COLUMNS, [
    "trading_day",
    "date",
    "p25",
    "median",
    "p75",
    "outer_low",
    "outer_high",
  ]);
});

test("default AAPL statistical regression stays within broad defensible ranges", { timeout: 30000 }, () => {
  const short = runSimulation(input({ horizon: 63 }));
  const medium = runSimulation(input({ horizon: 504 }));
  const long = runSimulation(input({ horizon: 1260 }));
  const start = 308.91;

  assert.ok(short.medianTerminal >= start * .97 && short.medianTerminal <= start * 1.08);
  assert.ok(medium.medianTerminal >= start * 1.15 && medium.medianTerminal <= start * 1.35);
  assert.ok(long.medianTerminal >= start * 1.45 && long.medianTerminal <= start * 1.85);
  assert.ok(long.p75Terminal < start * 2.75);
  assert.ok(long.medianTerminal < start * 2.5);
  assert.ok(long.probabilityAboveOneThousand < .05);
});

test("historical comparison retains the stationary bootstrap and correct day count", () => {
  const result = runSimulation(input({ modelMode: "historical", horizon: 21, simulations: 1500 }));
  assert.match(result.method, /Historical extrapolation/);
  assert.equal(result.median.length, 22);
  assert.equal(result.tradingDays, 21);
  assert.ok(result.expectedBlockLength >= 3);
});

test("the forward engine runs stock-specific profiles for multiple equities", () => {
  for (const [symbol, packKey, marketPE] of [
    ["MSFT", "MICROSOFT", 30],
    ["NVDA", "NVIDIA", 42],
    ["TSLA", "TESLA", null],
  ]) {
    const profile = historicalPack.profiles[packKey];
    const defaults = buildStockScenarioDefaults({
      symbol,
      historicalVolatility: profile.annualizedVolatility,
      latestVolatility: profile.latestAnnualizedVolatility * 100,
      marketPE,
    });
    const result = runSimulation(input({
      startingPrice: 200,
      targetPrice: 240,
      horizon: 63,
      simulations: 1200,
      historicalReturns: profile.logReturns.slice(-1260),
      returnRegimes: profile.volatilityRegimes.slice(-1260),
      currentVolatilityRegime: profile.currentVolatilityRegime,
      scenarios: defaults.scenarios.map((item) => ({
        ...item,
        probability: item.probability / 100,
        expectedReturn: item.expectedReturn / 100,
        volatility: item.volatility / 100,
        epsGrowth: item.epsGrowth / 100,
        epsVolatility: item.epsVolatility / 100,
      })),
      currentPE: defaults.currentPE,
      fundamentalAnchor: defaults.useFundamentalAnchor,
    }));
    assert.equal(result.median.length, 64);
    assert.ok(result.medianTerminal > 0 && Number.isFinite(result.medianTerminal));
    assert.match(result.method, defaults.useFundamentalAnchor ? /EPS\/P\/E anchor/ : /stock-specific market process/);
  }
});

test("P/E assumptions do not affect a price-only stock profile", () => {
  const base = input({ horizon: 63, simulations: 1500, fundamentalAnchor: false });
  const first = runSimulation({ ...base, currentPE: 8 });
  const second = runSimulation({
    ...base,
    currentPE: 80,
    scenarios: base.scenarios.map((scenario) => ({ ...scenario, targetPE: scenario.targetPE * 2 })),
  });
  assert.deepEqual(first.median, second.median);
  assert.equal(first.terminalPEMedian, 0);
  assert.match(first.method, /stock-specific market process/);
});
