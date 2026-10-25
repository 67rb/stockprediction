import { NextRequest, NextResponse } from "next/server";
import historicalPack from "@/data/monte-carlo-historical-pack.json";
import { fetchYahooHistory, sanitizeHistorySymbol } from "../yahoo-history";

export const dynamic = "force-dynamic";

const MINIMUM_RETURNS = 120;

type PackedProfile = {
  datasetKey: string;
  ticker: string;
  assetName: string;
  assetType: string;
  source: string;
  lookback: string;
  observations: number;
  periodsPerYear: number;
  startTime: number;
  endTime: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  logReturns: number[];
  volatilityRegimes: number[];
  currentVolatilityRegime: number;
  latestAnnualizedVolatility: number;
  quality: {
    sourceHourlyRows: number;
    dailyCloses: number;
    splitAdjustments: number;
    excludedReturns: Array<{ date: string; logReturn: number }>;
    duplicateTimestamps: number;
    invalidOhlcRows: number;
  };
};

const packedSymbolMap = historicalPack.symbolMap as Record<string, string>;
const packedProfiles = historicalPack.profiles as Record<string, PackedProfile>;

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0)
    / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index];
}

function volatilityRegimes(logReturns: number[], periodsPerYear: number) {
  const window = 21;
  const rolling = logReturns.map((_, index) => (
    index < window - 1
      ? null
      : standardDeviation(logReturns.slice(index - window + 1, index + 1))
        * Math.sqrt(periodsPerYear)
  ));
  const valid = rolling.filter((value): value is number => value !== null);
  const lowThreshold = quantile(valid, 1 / 3);
  const highThreshold = quantile(valid, 2 / 3);
  const labels = rolling.map((value) => (
    value === null ? 1 : value < lowThreshold ? 0 : value < highThreshold ? 1 : 2
  ));
  return {
    labels,
    current: labels.at(-1) || 1,
    latestAnnualizedVolatility: (valid.at(-1) || 0) * 100,
  };
}

export async function GET(request: NextRequest) {
  const requestedSymbol = sanitizeHistorySymbol(request.nextUrl.searchParams.get("symbol") || "AAPL");

  try {
    if (!requestedSymbol) throw new Error("Missing symbol");
    const packedKey = packedSymbolMap[requestedSymbol];
    const packed = packedKey ? packedProfiles[packedKey] : null;
    if (packed) {
      const response = NextResponse.json({
        requestedSymbol,
        historySymbol: packed.ticker,
        proxy: false,
        dataPack: true,
        source: packed.source,
        lookback: packed.lookback,
        observations: packed.observations,
        logReturns: packed.logReturns,
        volatilityRegimes: packed.volatilityRegimes,
        currentVolatilityRegime: packed.currentVolatilityRegime,
        periodsPerYear: packed.periodsPerYear,
        calendarMode: packed.periodsPerYear === 365 ? "calendar" : "trading",
        annualizedReturn: packed.annualizedReturn,
        annualizedVolatility: packed.annualizedVolatility,
        latestAnnualizedVolatility: packed.latestAnnualizedVolatility * 100,
        startTime: packed.startTime,
        endTime: packed.endTime,
        quality: packed.quality,
        methodology: historicalPack.methodology,
        sourcePackSha256: historicalPack.sourcePackSha256,
      });
      response.headers.set("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
      return response;
    }

    const history = await fetchYahooHistory(requestedSymbol, {
      range: "5y",
      interval: "1d",
      includePrePost: false,
    });
    const closes = history.rows.map((row) => ({ time: row.time, value: row.adjustedClose }));

    const logReturns = closes.slice(1).flatMap((point, index) => {
      const previous = closes[index].value;
      const dailyReturn = Math.log(point.value / previous);
      return Number.isFinite(dailyReturn) ? [dailyReturn] : [];
    });
    if (logReturns.length < MINIMUM_RETURNS) throw new Error("Not enough daily history");

    const meanLogReturn = average(logReturns);
    const variance = logReturns.reduce(
      (total, value) => total + (value - meanLogReturn) ** 2,
      0,
    ) / (logReturns.length - 1);
    const periodsPerYear = requestedSymbol.endsWith("-USD") ? 365 : 252;
    const regimes = volatilityRegimes(logReturns, periodsPerYear);

    const response = NextResponse.json({
      requestedSymbol: history.requestedSymbol,
      historySymbol: history.historySymbol,
      proxy: history.proxy,
      dataPack: false,
      source: history.source,
      lookback: "5 years",
      observations: closes.length,
      logReturns,
      volatilityRegimes: regimes.labels,
      currentVolatilityRegime: regimes.current,
      periodsPerYear,
      calendarMode: periodsPerYear === 365 ? "calendar" : "trading",
      annualizedReturn: (Math.exp(meanLogReturn * periodsPerYear) - 1) * 100,
      annualizedVolatility: Math.sqrt(variance * periodsPerYear) * 100,
      latestAnnualizedVolatility: regimes.latestAnnualizedVolatility,
      startTime: closes[0].time,
      endTime: closes[closes.length - 1].time,
    });
    response.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Historical market data is currently unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
