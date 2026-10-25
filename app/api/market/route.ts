import { NextRequest, NextResponse } from "next/server";
import { fetchGoldSpot, GOLD_SPOT_SYMBOL } from "../gold";

export const dynamic = "force-dynamic";

type RangeKey = "1D" | "1W" | "1M" | "3M" | "1Y";

const ranges: Record<RangeKey, { period: string; interval: string }> = {
  "1D": { period: "1d", interval: "5m" },
  "1W": { period: "5d", interval: "30m" },
  "1M": { period: "1mo", interval: "1d" },
  "3M": { period: "3mo", interval: "1d" },
  "1Y": { period: "1y", interval: "1wk" },
};

const companyNames: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  AMZN: "Amazon.com, Inc.",
  TSLA: "Tesla, Inc.",
  META: "Meta Platforms, Inc.",
  GOOGL: "Alphabet Inc.",
  AMD: "Advanced Micro Devices, Inc.",
  NFLX: "Netflix, Inc.",
  JPM: "JPMorgan Chase & Co.",
};

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function GET(request: NextRequest) {
  const rawSymbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
  const requestedRange = request.nextUrl.searchParams.get("range") as RangeKey | null;
  const range: RangeKey = requestedRange && requestedRange in ranges ? requestedRange : "1D";
  try {
    if (symbol === GOLD_SPOT_SYMBOL) {
      const spot = await fetchGoldSpot();
      const response = NextResponse.json({
        symbol: GOLD_SPOT_SYMBOL,
        name: "Gold Spot / U.S. Dollar",
        price: spot.price,
        previousClose: spot.price,
        change: 0,
        changePercent: 0,
        currency: "USD",
        exchange: "SPOT · GOLD API",
        marketState: "OPEN",
        live: true,
        sourceTimestamp: spot.timestamp,
        fetchedAt: Date.now(),
        range: "1D",
        high: spot.price,
        low: spot.price,
        open: spot.price,
        volume: 0,
        points: [
          { time: spot.timestamp - 1, value: spot.price },
          { time: spot.timestamp, value: spot.price },
        ],
      });
      response.headers.set("Cache-Control", "public, s-maxage=1, stale-while-revalidate=1");
      return response;
    }

    const { period, interval } = ranges[range];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${period}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
      },
    });

    if (!upstream.ok) throw new Error(`Upstream status ${upstream.status}`);
    const payload = await upstream.json() as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null>; open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; volume?: Array<number | null> }> };
        }>;
      };
    };
    const result = payload.chart?.result?.[0];
    const meta = result?.meta;
    const series = result?.indicators?.quote?.[0];
    if (!result || !meta || !series) throw new Error("Missing chart data");

    const points = (result.timestamp || [])
      .map((time, index) => ({ time, value: series.close?.[index] }))
      .filter((point): point is { time: number; value: number } => typeof point.value === "number" && Number.isFinite(point.value));
    if (points.length < 2) throw new Error("Not enough chart points");

    const price = safeNumber(meta.regularMarketPrice, points[points.length - 1].value);
    const previousClose = safeNumber(meta.chartPreviousClose, safeNumber(meta.previousClose, points[0].value));
    const change = price - previousClose;
    const highs = (series.high || []).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const lows = (series.low || []).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const opens = (series.open || []).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const volume = (series.volume || []).reduce((total: number, value) => total + (typeof value === "number" ? value : 0), 0);

    const response = NextResponse.json({
      symbol: String(meta.symbol || symbol),
      name: String(meta.longName || meta.shortName || companyNames[symbol] || `${symbol} market quote`),
      price,
      previousClose,
      change,
      changePercent: previousClose ? (change / previousClose) * 100 : 0,
      currency: String(meta.currency || "USD"),
      exchange: String(meta.exchangeName || meta.fullExchangeName || "US"),
      marketState: String(meta.marketState || "REGULAR"),
      live: true,
      sourceTimestamp: safeNumber(meta.regularMarketTime, points[points.length - 1].time),
      fetchedAt: Date.now(),
      range,
      high: highs.length ? Math.max(...highs) : Math.max(...points.map((point) => point.value)),
      low: lows.length ? Math.min(...lows) : Math.min(...points.map((point) => point.value)),
      open: opens[0] || points[0].value,
      volume,
      points,
      trailingPE: optionalPositiveNumber(meta.trailingPE),
      forwardPE: optionalPositiveNumber(meta.forwardPE),
      trailingEPS: optionalPositiveNumber(meta.epsTrailingTwelveMonths),
    });
    response.headers.set("Cache-Control", "public, s-maxage=1, stale-while-revalidate=1");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Live market data is currently unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
