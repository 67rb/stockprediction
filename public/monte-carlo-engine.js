export const CSV_COLUMNS = [
  "trading_day",
  "date",
  "p25",
  "median",
  "p75",
  "outer_low",
  "outer_high",
];

const MIN_PRICE = Number.MIN_VALUE;
const MAX_LOG_PRICE = Math.log(Number.MAX_VALUE) - 2;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function annualToDailyLogDrift(annualReturn, annualVolatility, periodsPerYear = 252) {
  if (annualReturn <= -1 || annualVolatility < 0 || periodsPerYear <= 0) {
    throw new Error("Invalid annual return, volatility, or period count");
  }
  return (Math.log1p(annualReturn) - 0.5 * annualVolatility ** 2) / periodsPerYear;
}

export function annualToDailyVolatility(annualVolatility, periodsPerYear = 252) {
  if (annualVolatility < 0 || periodsPerYear <= 0) {
    throw new Error("Invalid annual volatility or period count");
  }
  return annualVolatility / Math.sqrt(periodsPerYear);
}

export function percentileSorted(sortedValues, percentile) {
  if (!sortedValues.length) return Number.NaN;
  const position = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  return lower + (upper - lower) * (position - lowerIndex);
}

export function meanRevertingPE(currentPE, targetPE, speed, yearsElapsed) {
  return targetPE + (currentPE - targetPE) * Math.exp(-speed * Math.max(0, yearsElapsed));
}

export function fundamentalWeight(yearsElapsed) {
  // The market process dominates early; the EPS/P-E anchor takes over smoothly
  // over roughly three years without an abrupt switch at the one-year mark.
  const progress = clamp(yearsElapsed / 2.5, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

export function medianCagr(startingPrice, endingPrice, tradingDays, periodsPerYear = 252) {
  if (startingPrice <= 0 || endingPrice <= 0 || tradingDays <= 0 || periodsPerYear <= 0) return 0;
  return (endingPrice / startingPrice) ** (periodsPerYear / tradingDays) - 1;
}

export function createSeededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createNormalSampler(random) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const first = Math.max(Number.MIN_VALUE, random());
    const second = random();
    const radius = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

function gammaShape(random, normal, shape) {
  if (shape < 1) {
    return gammaShape(random, normal, shape + 1) * random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = normal();
    const base = 1 + c * x;
    if (base <= 0) continue;
    const v = base ** 3;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function createInnovationSampler(random, fatTails, degreesOfFreedom) {
  const normal = createNormalSampler(random);
  if (!fatTails) return normal;
  const degrees = clamp(Math.round(degreesOfFreedom || 6), 5, 30);
  return () => {
    // A Student-t is a normal divided by an independent chi-square scale.
    // Multiplying by sqrt((df - 2) / df) restores unit variance.
    let chiSquare;
    if (degrees === 6) {
      chiSquare = -2 * Math.log(
        Math.max(Number.MIN_VALUE, random() * random() * random()),
      );
    } else {
      chiSquare = 2 * gammaShape(random, normal, degrees / 2);
    }
    return normal() / Math.sqrt(chiSquare / degrees) * Math.sqrt((degrees - 2) / degrees);
  };
}

export function selectScenarioIndex(randomValue, scenarios) {
  let cumulative = 0;
  for (let index = 0; index < scenarios.length; index += 1) {
    cumulative += scenarios[index].probability;
    if (randomValue < cumulative || index === scenarios.length - 1) return index;
  }
  return scenarios.length - 1;
}

function validateScenarios(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length < 1) throw new Error("Missing scenarios");
  const probabilityTotal = scenarios.reduce((total, scenario) => total + scenario.probability, 0);
  if (Math.abs(probabilityTotal - 1) > 0.0001) throw new Error("Scenario probabilities must total 100%");
  for (const scenario of scenarios) {
    if (
      !scenario.id
      || scenario.probability < 0
      || scenario.expectedReturn <= -1
      || scenario.volatility <= 0
      || scenario.epsGrowth <= -1
      || scenario.epsVolatility < 0
      || scenario.targetPE <= 0
    ) throw new Error("Invalid scenario assumptions");
  }
}

function safeExp(logValue) {
  const value = Math.exp(Math.min(MAX_LOG_PRICE, logValue));
  if (!Number.isFinite(value) || value <= 0) throw new Error("Non-finite simulated price");
  return Math.max(MIN_PRICE, value);
}

function buildTerminalBins(terminalPrices, startingPrice) {
  const binCount = 24;
  const low = percentileSorted(terminalPrices, 0.01);
  const high = percentileSorted(terminalPrices, 0.99);
  const width = Math.max((high - low) / binCount, startingPrice * 0.000001);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    low: low + index * width,
    high: index === binCount - 1 ? high : low + (index + 1) * width,
    count: 0,
  }));
  for (const value of terminalPrices) {
    const index = clamp(Math.floor((value - low) / width), 0, binCount - 1);
    bins[index].count += 1;
  }
  return bins;
}

function historicalSampleIndex(random, historicalReturns, returnRegimes, currentRegime, regime) {
  const recentDays = regime === "recent" ? 252 : 504;
  const recentStart = Math.max(0, historicalReturns.length - recentDays);
  const matching = Array.isArray(returnRegimes) && returnRegimes.length === historicalReturns.length
    ? returnRegimes.flatMap((label, index) => label === currentRegime ? [index] : [])
    : [];
  return () => {
    if (regime === "balanced" && matching.length >= 20 && random() < 0.72) {
      return matching[Math.floor(random() * matching.length)];
    }
    if (regime === "recent" && recentStart > 0 && random() < 0.9) {
      return recentStart + Math.floor(random() * (historicalReturns.length - recentStart));
    }
    if (regime === "balanced" && recentStart > 0 && random() < 0.35) {
      return recentStart + Math.floor(random() * (historicalReturns.length - recentStart));
    }
    return Math.floor(random() * historicalReturns.length);
  };
}

function summarize({
  dailyPrices,
  terminalPrices,
  maxDrawdowns,
  underwaterDays,
  samplePaths,
  scenarioCounts,
  scenarioPEs,
  input,
  method,
  expectedBlockLength,
}) {
  const { simulations, horizon, startingPrice, targetPrice, periodsPerYear } = input;
  const p05 = [];
  const p25 = [];
  const p50 = [];
  const p75 = [];
  const p95 = [];
  for (let day = 0; day <= horizon; day += 1) {
    const values = dailyPrices.subarray(day * simulations, (day + 1) * simulations);
    values.sort();
    p05.push(percentileSorted(values, 0.05));
    p25.push(percentileSorted(values, 0.25));
    p50.push(percentileSorted(values, 0.5));
    p75.push(percentileSorted(values, 0.75));
    p95.push(percentileSorted(values, 0.95));
  }
  terminalPrices.sort();
  maxDrawdowns.sort();
  underwaterDays.sort();
  scenarioPEs.sort();
  const medianTerminal = percentileSorted(terminalPrices, 0.5);
  const tailCount = Math.max(1, Math.ceil(simulations * 0.05));
  let tailTotal = 0;
  for (let index = 0; index < tailCount; index += 1) tailTotal += terminalPrices[index];
  const count = (predicate) => {
    let matches = 0;
    for (const value of terminalPrices) if (predicate(value)) matches += 1;
    return matches;
  };
  const probabilityAboveTarget = count((value) => value >= targetPrice) / simulations;
  const scenarioShares = Object.fromEntries(
    Object.entries(scenarioCounts).map(([key, value]) => [key, value / simulations]),
  );

  return {
    p25,
    median: p50,
    p75,
    outerLow: p05,
    outerHigh: p95,
    samplePaths,
    terminalBins: buildTerminalBins(terminalPrices, startingPrice),
    simulations,
    tradingDays: horizon,
    method,
    expectedBlockLength,
    confidenceLevel: 90,
    percentileDefinitions: "p05 / p25 / p50 / p75 / p95 from all simulated paths",
    observationsUsed: input.historicalReturns.length,
    medianTerminal,
    lowTerminal: percentileSorted(terminalPrices, 0.05),
    highTerminal: percentileSorted(terminalPrices, 0.95),
    p25Terminal: percentileSorted(terminalPrices, 0.25),
    p75Terminal: percentileSorted(terminalPrices, 0.75),
    medianGain: medianTerminal / startingPrice - 1,
    medianCagr: medianCagr(startingPrice, medianTerminal, horizon, periodsPerYear),
    probabilityAboveTarget,
    probabilityMargin: 1.96 * Math.sqrt(
      Math.max(0, probabilityAboveTarget * (1 - probabilityAboveTarget)) / simulations,
    ),
    probabilityBelowStart: count((value) => value < startingPrice) / simulations,
    probabilityGainOverTwenty: count((value) => value >= startingPrice * 1.2) / simulations,
    probabilityLossOverTwenty: count((value) => value <= startingPrice * 0.8) / simulations,
    probabilityOfGain: count((value) => value >= startingPrice) / simulations,
    probabilityOfTenPercentLoss: count((value) => value <= startingPrice * 0.9) / simulations,
    medianMaxDrawdown: percentileSorted(maxDrawdowns, 0.5),
    probabilityOfHalfLoss: 0,
    medianTimeUnderwater: percentileSorted(underwaterDays, 0.5),
    expectedShortfallReturn: tailTotal / tailCount / startingPrice - 1,
    scenarioShares,
    terminalPEMedian: percentileSorted(scenarioPEs, 0.5),
    probabilityAboveOneThousand: count((value) => value > 1000) / simulations,
  };
}

export function runSimulation(rawInput, onProgress = () => {}) {
  const input = {
    ...rawInput,
    horizon: clamp(Math.round(rawInput.horizon), 5, 1260),
    simulations: clamp(Math.round(rawInput.simulations), 1000, 50000),
  };
  if (
    !input.requestId
    || !Number.isFinite(input.startingPrice)
    || input.startingPrice <= 0
    || !Number.isFinite(input.targetPrice)
    || input.targetPrice <= 0
    || !Array.isArray(input.historicalReturns)
    || input.historicalReturns.length < 5
    || !Number.isFinite(input.periodsPerYear)
    || input.periodsPerYear < 200
    || input.periodsPerYear > 366
    || !["realistic", "historical", "custom"].includes(input.modelMode)
  ) throw new Error("Invalid simulation input");
  if (input.modelMode !== "historical") validateScenarios(input.scenarios);

  const random = createSeededRandom(input.seed);
  const innovation = createInnovationSampler(random, input.fatTails, input.degreesOfFreedom);
  const fundamentalAnchor = input.fundamentalAnchor !== false;
  const { simulations, horizon, startingPrice, periodsPerYear } = input;
  const dailyPrices = new Float32Array((horizon + 1) * simulations);
  const terminalPrices = new Float64Array(simulations);
  const maxDrawdowns = new Float64Array(simulations);
  const underwaterDays = new Uint16Array(simulations);
  const scenarioPEs = new Float64Array(simulations);
  const samplePaths = [];
  const scenarioCounts = {};
  const expectedBlockLength = Math.min(10, Math.max(3, Math.round(Math.sqrt(horizon))));
  const restartProbability = 1 / expectedBlockLength;
  const sampleHistoricalIndex = historicalSampleIndex(
    random,
    input.historicalReturns,
    input.returnRegimes,
    input.currentVolatilityRegime,
    input.regime,
  );
  let halfLossPaths = 0;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    let price = startingPrice;
    let marketLogPrice = Math.log(startingPrice);
    let peak = price;
    let maxDrawdown = 0;
    let pathUnderwater = 0;
    let scenario = null;
    let scenarioId = "historical";
    let currentPE = Math.max(1, input.currentPE || 28);
    let eps = startingPrice / currentPE;
    let annualEpsGrowth = 0;
    let highVolatility = input.currentVolatilityRegime === 2 && random() < 0.55;
    let historicalIndex = sampleHistoricalIndex();
    const path = simulation < 40 ? [price] : null;
    dailyPrices[simulation] = price;

    if (input.modelMode !== "historical") {
      const scenarioIndex = selectScenarioIndex(random(), input.scenarios);
      scenario = input.scenarios[scenarioIndex];
      scenarioId = scenario.id;
      annualEpsGrowth = clamp(
        scenario.epsGrowth + scenario.epsVolatility * innovation(),
        -0.2,
        0.3,
      );
    }
    scenarioCounts[scenarioId] = (scenarioCounts[scenarioId] || 0) + 1;

    for (let day = 1; day <= horizon; day += 1) {
      if (input.modelMode === "historical") {
        if (day > 1) {
          historicalIndex = random() < restartProbability
            ? sampleHistoricalIndex()
            : (historicalIndex + 1) % input.historicalReturns.length;
        }
        marketLogPrice += input.historicalReturns[historicalIndex];
        price = safeExp(marketLogPrice);
      } else {
        if ((day - 1) % periodsPerYear === 0 && day > 1) {
          annualEpsGrowth = clamp(
            scenario.epsGrowth + scenario.epsVolatility * innovation(),
            -0.2,
            0.3,
          );
        }

        const regimeVolatility = highVolatility
          ? clamp(Math.max(0.38, scenario.volatility * 1.5), 0.38, 0.45)
          : scenario.volatility;
        const shock = innovation();
        let dailyLogReturn = annualToDailyLogDrift(
          scenario.expectedReturn,
          regimeVolatility,
          periodsPerYear,
        ) + annualToDailyVolatility(regimeVolatility, periodsPerYear) * shock;

        if (input.jumpRisk && random() < input.annualJumpProbability / periodsPerYear) {
          const negative = random() < 0.64;
          let magnitude = 0.08 + -Math.log(Math.max(Number.MIN_VALUE, random())) * 0.035;
          if (random() < 0.06) magnitude += 0.12 + random() * 0.15;
          magnitude = clamp(magnitude * (negative ? 1.12 : 0.9), 0.04, 0.48);
          dailyLogReturn += negative ? Math.log1p(-magnitude) : Math.log1p(magnitude);
        }

        marketLogPrice += dailyLogReturn;
        const yearsElapsed = day / periodsPerYear;
        eps *= Math.exp(Math.log1p(annualEpsGrowth) / periodsPerYear);
        const pe = meanRevertingPE(currentPE, scenario.targetPE, input.meanReversionSpeed, yearsElapsed);
        const fundamentalLogPrice = Math.log(Math.max(MIN_PRICE, eps * pe));
        const weight = fundamentalAnchor ? fundamentalWeight(yearsElapsed) : 0;
        const blendedLogPrice = (1 - weight) * marketLogPrice + weight * fundamentalLogPrice;
        price = safeExp(blendedLogPrice);

        if (highVolatility) {
          if (random() < 0.045) highVolatility = false;
        } else {
          const downsideTrigger = shock < -1.5 || dailyLogReturn < -0.025;
          const transitionProbability = downsideTrigger ? 0.16 : 0.0045;
          if (random() < transitionProbability) highVolatility = true;
        }
      }

      peak = Math.max(peak, price);
      maxDrawdown = Math.max(maxDrawdown, (peak - price) / peak);
      if (price < peak) pathUnderwater += 1;
      dailyPrices[day * simulations + simulation] = price;
      if (path) path.push(price);
    }

    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid terminal price");
    terminalPrices[simulation] = price;
    maxDrawdowns[simulation] = maxDrawdown;
    underwaterDays[simulation] = pathUnderwater;
    scenarioPEs[simulation] = scenario && fundamentalAnchor
      ? meanRevertingPE(currentPE, scenario.targetPE, input.meanReversionSpeed, horizon / periodsPerYear)
      : 0;
    if (path) samplePaths.push(path);
    if (maxDrawdown >= 0.5) halfLossPaths += 1;
    if (simulation > 0 && simulation % Math.max(100, Math.floor(simulations / 100)) === 0) {
      onProgress(Math.min(0.84, simulation / simulations * 0.84));
    }
  }

  onProgress(0.88);
  const result = summarize({
    dailyPrices,
    terminalPrices,
    maxDrawdowns,
    underwaterDays,
    samplePaths,
    scenarioCounts,
    scenarioPEs,
    input,
    method: input.modelMode === "historical"
      ? "Historical extrapolation — may overstate long-term growth"
      : fundamentalAnchor
        ? "Forward scenarios + EPS/P/E anchor"
        : "Forward scenarios + stock-specific market process",
    expectedBlockLength: input.modelMode === "historical" ? expectedBlockLength : 0,
  });
  result.probabilityOfHalfLoss = halfLossPaths / simulations;
  return result;
}
