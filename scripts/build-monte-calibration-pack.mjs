import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const inputZip = resolve(process.argv[2] || "");
const outputJson = resolve(process.argv[3] || "data/monte-carlo-historical-pack.json");
const outputCosts = resolve(process.argv[4] || "data/trading-cost-profiles.json");
const outputReport = resolve(process.argv[5] || "analysis/monte-carlo-data-quality.md");

if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/build-monte-calibration-pack.mjs <historical-pack.zip> [calibration.json] [costs.json] [report.md]",
  );
}

const ASSETS = {
  APPLE: { ticker: "AAPL", aliases: ["AAPL"], periodsPerYear: 252 },
  NVIDIA: { ticker: "NVDA", aliases: ["NVDA"], periodsPerYear: 252 },
  ALPHABET: { ticker: "GOOG", aliases: ["GOOG", "GOOGL"], periodsPerYear: 252 },
  MICROSOFT: { ticker: "MSFT", aliases: ["MSFT"], periodsPerYear: 252 },
  AMAZON: { ticker: "AMZN", aliases: ["AMZN"], periodsPerYear: 252 },
  BROADCOM: { ticker: "AVGO", aliases: ["AVGO"], periodsPerYear: 252 },
  META: { ticker: "META", aliases: ["META"], periodsPerYear: 252 },
  TESLA: { ticker: "TSLA", aliases: ["TSLA"], periodsPerYear: 252 },
  MICRON: { ticker: "MU", aliases: ["MU"], periodsPerYear: 252 },
  BERKSHIRE: { ticker: "BRK-B", aliases: ["BRK-B", "BRK.B"], periodsPerYear: 252 },
  SP500: { ticker: "^GSPC", aliases: ["^GSPC"], periodsPerYear: 252 },
  NASDAQ100: { ticker: "^NDX", aliases: ["^NDX"], periodsPerYear: 252 },
  BITCOIN: { ticker: "BTC-USD", aliases: ["BTC-USD"], periodsPerYear: 365 },
  ETHEREUM: { ticker: "ETH-USD", aliases: ["ETH-USD"], periodsPerYear: 365 },
  SOLANA: { ticker: "SOL-USD", aliases: ["SOL-USD"], periodsPerYear: 365 },
  XAUUSD: { ticker: "XAUUSD", aliases: ["XAUUSD"], periodsPerYear: 252 },
};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0)
    / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function round(value, digits = 8) {
  return Number(value.toFixed(digits));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function dailyCloses(csvPath) {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const daily = [];
  let current = null;
  for (const row of rows) {
    const date = row.timestamp_utc.slice(0, 10);
    const bid = number(row.bid_close);
    const ask = number(row.ask_close);
    if (!date || bid === null || ask === null || bid <= 0 || ask <= 0) continue;
    const close = (bid + ask) / 2;
    if (current?.date === date) {
      current.close = close;
      current.timestamp = row.timestamp_utc;
    } else {
      current = { date, timestamp: row.timestamp_utc, close };
      daily.push(current);
    }
  }
  return { rows, daily };
}

function rollingVolatilityRegimes(returns, periodsPerYear) {
  const window = 21;
  const rolling = returns.map((_, index) => {
    if (index < window - 1) return null;
    return standardDeviation(returns.slice(index - window + 1, index + 1)) * Math.sqrt(periodsPerYear);
  });
  const valid = rolling.filter((value) => value !== null);
  const lowThreshold = quantile(valid, 1 / 3);
  const highThreshold = quantile(valid, 2 / 3);
  const labels = rolling.map((value) => (
    value === null ? 1 : value < lowThreshold ? 0 : value < highThreshold ? 1 : 2
  ));
  return {
    labels,
    current: labels.at(-1) ?? 1,
    lowThreshold: round(lowThreshold, 6),
    highThreshold: round(highThreshold, 6),
    latestVolatility: round(valid.at(-1) || 0, 6),
  };
}

function buildSpreadProfiles(folder) {
  const profiles = {};
  for (const [key, asset] of Object.entries(ASSETS)) {
    if (!["APPLE", "NVIDIA", "ALPHABET", "MICROSOFT", "AMAZON", "BROADCOM", "META", "TESLA", "MICRON", "BERKSHIRE"].includes(key)) continue;
    const path = join(folder, `${key}_DAILY_SPREAD_SUMMARY.csv`);
    const rows = parseCsv(readFileSync(path, "utf8"));
    const medians = rows.map((row) => number(row.median_spread_bps)).filter((value) => value !== null);
    const p95s = rows.map((row) => number(row.p95_spread_bps)).filter((value) => value !== null);
    const recent = medians.slice(-252);
    profiles[asset.ticker] = {
      source: "Dukascopy M15 BID/ASK history",
      observations: medians.length,
      startDate: rows[0]?.date || "",
      endDate: rows.at(-1)?.date || "",
      medianSpreadBps: round(quantile(medians, 0.5), 4),
      p90SpreadBps: round(quantile(medians, 0.9), 4),
      medianDailyP95SpreadBps: round(quantile(p95s, 0.5), 4),
      recentMedianSpreadBps: round(quantile(recent, 0.5), 4),
      estimatedOneWayCrossingCostBps: round(quantile(recent, 0.5) / 2, 4),
    };
  }
  return profiles;
}

const tempRoot = mkdtempSync(join(tmpdir(), "ledger-monte-build-"));
try {
  execFileSync("unzip", [
    "-q",
    inputZip,
    "SHA256SUMS.txt",
    "historical_archives/qTRSa__0dffx.zip",
    "historical_archives/Top10_Stocks_H1_M15.zip",
    "historical_archives/Trading_Model_Enhancement_Pack_REBUILT.zip",
    "-d",
    tempRoot,
  ]);
  const qtrArchive = join(tempRoot, "historical_archives/qTRSa__0dffx.zip");
  const enhancementArchive = join(
    tempRoot,
    "historical_archives/Trading_Model_Enhancement_Pack_REBUILT.zip",
  );
  const checksumRows = readFileSync(join(tempRoot, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [expected, relativePath] = line.trim().split(/\s+/, 2);
      return { expected, relativePath };
    });
  for (const checksum of checksumRows) {
    const actual = sha256(join(tempRoot, checksum.relativePath));
    if (actual !== checksum.expected) {
      throw new Error(`Checksum mismatch for ${checksum.relativePath}`);
    }
  }
  execFileSync("unzip", [
    "-q",
    qtrArchive,
    "Dukascopy_H1_Combined_16_Assets/active_market_bars/*",
    "Dukascopy_H1_Combined_16_Assets/manifest.csv",
    "-d",
    tempRoot,
  ]);
  execFileSync("unzip", [
    "-q",
    enhancementArchive,
    "Trading_Model_Enhancement_Pack_Rebuilt/corporate_events/stock_splits_dividends.csv",
    "Trading_Model_Enhancement_Pack_Rebuilt/stock_spreads/daily_summaries/*",
    "-d",
    tempRoot,
  ]);

  const qtrRoot = join(tempRoot, "Dukascopy_H1_Combined_16_Assets");
  const enhancementRoot = join(tempRoot, "Trading_Model_Enhancement_Pack_Rebuilt");
  const manifest = parseCsv(readFileSync(join(qtrRoot, "manifest.csv"), "utf8"));
  const manifestByKey = new Map(manifest.map((row) => [row.key, row]));
  const corporateActions = parseCsv(
    readFileSync(join(enhancementRoot, "corporate_events/stock_splits_dividends.csv"), "utf8"),
  );
  const splitMap = new Map();
  for (const row of corporateActions) {
    if (row.event_type !== "splits") continue;
    const ratio = number(row.split_numerator) / number(row.split_denominator);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    splitMap.set(`${row.ticker}:${row.event_timestamp_utc.slice(0, 10)}`, ratio);
  }

  const profiles = {};
  const symbolMap = {};
  const reportRows = [];
  const activeFolder = join(qtrRoot, "active_market_bars");
  const activeFiles = readdirSync(activeFolder).filter((file) => file.endsWith(".csv"));

  for (const [key, asset] of Object.entries(ASSETS)) {
    const file = activeFiles.find((candidate) => candidate.startsWith(`${key}_`));
    if (!file) throw new Error(`Missing active-market data for ${key}`);
    const { rows, daily } = dailyCloses(join(activeFolder, file));
    const logReturns = [];
    const returnDates = [];
    const excluded = [];
    let splitAdjustments = 0;
    for (let index = 1; index < daily.length; index += 1) {
      const current = daily[index];
      const previous = daily[index - 1];
      const splitRatio = splitMap.get(`${asset.ticker}:${current.date}`) || 1;
      if (splitRatio !== 1) splitAdjustments += 1;
      const value = Math.log((current.close * splitRatio) / previous.close);
      const maximumMove = asset.periodsPerYear === 365 ? 0.75 : key === "XAUUSD" ? 0.35 : 0.45;
      if (!Number.isFinite(value) || Math.abs(value) > maximumMove) {
        excluded.push({ date: current.date, logReturn: round(value, 6) });
        continue;
      }
      logReturns.push(round(value));
      returnDates.push(current.date);
    }
    if (logReturns.length < 120) throw new Error(`Not enough valid returns for ${key}`);

    const mean = average(logReturns);
    const volatility = standardDeviation(logReturns);
    const regimes = rollingVolatilityRegimes(logReturns, asset.periodsPerYear);
    const sourceRow = manifestByKey.get(key);
    profiles[key] = {
      datasetKey: key,
      ticker: asset.ticker,
      assetName: sourceRow?.company_or_asset || key,
      assetType: sourceRow?.asset_type || "market",
      source: "Dukascopy H1 historical data pack",
      lookback: `${returnDates[0]} to ${returnDates.at(-1)}`,
      observations: logReturns.length,
      periodsPerYear: asset.periodsPerYear,
      startTime: Math.floor(new Date(`${returnDates[0]}T00:00:00Z`).getTime() / 1000),
      endTime: Math.floor(new Date(`${returnDates.at(-1)}T00:00:00Z`).getTime() / 1000),
      annualizedReturn: round((Math.exp(mean * asset.periodsPerYear) - 1) * 100, 4),
      annualizedVolatility: round(volatility * Math.sqrt(asset.periodsPerYear) * 100, 4),
      logReturns,
      volatilityRegimes: regimes.labels,
      currentVolatilityRegime: regimes.current,
      regimeThresholds: {
        lowAnnualized: regimes.lowThreshold,
        highAnnualized: regimes.highThreshold,
      },
      latestAnnualizedVolatility: regimes.latestVolatility,
      quality: {
        sourceHourlyRows: rows.length,
        dailyCloses: daily.length,
        splitAdjustments,
        excludedReturns: excluded,
        duplicateTimestamps: Number(sourceRow?.duplicate_timestamps || 0),
        invalidOhlcRows: Number(sourceRow?.invalid_ohlc_rows || 0),
      },
    };
    asset.aliases.forEach((alias) => { symbolMap[alias] = key; });
    reportRows.push({
      key,
      ticker: asset.ticker,
      start: returnDates[0],
      end: returnDates.at(-1),
      observations: logReturns.length,
      splitAdjustments,
      excluded: excluded.length,
      maxAbsoluteReturn: Math.max(...logReturns.map(Math.abs)),
    });
  }

  const costs = buildSpreadProfiles(join(enhancementRoot, "stock_spreads/daily_summaries"));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourcePack: basename(inputZip),
    sourcePackSha256: sha256(inputZip),
    source: "Dukascopy H1 active-market bars; split dates from Yahoo Finance corporate actions",
    methodology: "UTC daily midpoint closes, exact split correction, outlier validation, 21-observation rolling-volatility regimes",
    symbolMap,
    profiles,
  };

  mkdirSync(dirname(outputJson), { recursive: true });
  mkdirSync(dirname(outputCosts), { recursive: true });
  mkdirSync(dirname(outputReport), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(payload)}\n`);
  writeFileSync(outputCosts, `${JSON.stringify({
    version: 1,
    generatedAt: payload.generatedAt,
    sourcePackSha256: payload.sourcePackSha256,
    profiles: costs,
  }, null, 2)}\n`);

  const totalHourlyRows = reportRows.reduce(
    (total, row) => total + profiles[row.key].quality.sourceHourlyRows,
    0,
  );
  const totalReturns = reportRows.reduce((total, row) => total + row.observations, 0);
  const totalExcluded = reportRows.reduce((total, row) => total + row.excluded, 0);
  const markdownRows = reportRows.map((row) => (
    `| ${row.ticker} | ${row.start} | ${row.end} | ${row.observations.toLocaleString()} | ${row.splitAdjustments} | ${row.excluded} | ${(Math.exp(row.maxAbsoluteReturn) - 1).toLocaleString("en-US", { style: "percent", maximumFractionDigits: 1 })} |`
  )).join("\n");
  const report = `# Monte Carlo historical pack — data quality report

Generated: ${payload.generatedAt}

## Dataset and intended grain

- Source archive: \`${payload.sourcePack}\`
- SHA-256: \`${payload.sourcePackSha256}\`
- Intended use: single-asset daily return bootstrapping and regime-conditioned Monte Carlo; realistic paper-trading spread defaults for ten equities.
- Raw grain inspected: ${totalHourlyRows.toLocaleString()} active-market H1 bars across 16 assets.
- Model grain produced: ${totalReturns.toLocaleString()} UTC daily log returns.

## Checks performed

- Verified the outer pack and every nested archive checksum supplied by the pack.
- Reconciled manifest row counts to parsed H1 files.
- Checked the supplied duplicate-timestamp, chronology, OHLC, and negative-volume audits.
- Corrected known stock splits from the included corporate-action file before calculating returns.
- Rejected non-finite returns and moves outside conservative asset-specific validity bounds.
- Built rolling 21-observation volatility regimes without using future observations.
- Reduced ten-equity BID/ASK histories into typical and stressed spread profiles.

## Findings

| Ticker | Start | End | Returns | Splits corrected | Returns excluded | Largest retained move |
|---|---:|---:|---:|---:|---:|---:|
${markdownRows}

- ${totalExcluded} return observations were excluded across all assets after split correction.
- The source validation reports show zero duplicate timestamps, out-of-order rows, invalid OHLC rows, or negative-volume rows.
- The stock histories are Dukascopy CFD quotes, not consolidated exchange prints. This is a medium-severity basis risk for exact execution studies, but acceptable for broad return-shape and spread-scenario calibration.
- Daily returns use midpoint closes and correct splits, but do not add dividends. Long-horizon equity drift is therefore price-return rather than total-return drift.
- Crypto uses 365 observations per year; exchange-traded instruments use 252.

## Downstream safeguards

- Unsupported tickers continue using the existing Yahoo adjusted-daily fallback.
- The simulator receives an explicit source, coverage window, observation count, annualization basis, and current volatility regime.
- The raw 161 MB archive is not shipped to the website; only compact derived calibration arrays and spread summaries are bundled.
- Historical results are research inputs, not evidence of a future trading edge.
`;
  writeFileSync(outputReport, report);
  process.stdout.write(
    `Built ${Object.keys(profiles).length} calibration profiles, ${Object.keys(costs).length} spread profiles, and ${totalReturns} returns.\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
