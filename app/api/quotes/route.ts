import { NextRequest, NextResponse } from "next/server";
import { fetchGoldSpot, GOLD_SPOT_SYMBOL } from "../gold";

export const dynamic = "force-dynamic";

const companyNames: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  AMZN: "Amazon.com Inc.",
  TSLA: "Tesla Inc.",
  META: "Meta Platforms Inc.",
  GOOGL: "Alphabet Inc.",
  AMD: "Advanced Micro Devices",
  NFLX: "Netflix Inc.",
  JPM: "JPMorgan Chase",
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^IXIC": "Nasdaq Composite",
};

async function fetchQuote(symbol: string) {
  if (symbol === GOLD_SPOT_SYMBOL) {
    const spot = await fetchGoldSpot();
    return {
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
    };
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  const upstream = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
    },
  });
  if (!upstream.ok) throw new Error("Quote failed");
  const payload = await upstream.json() as {
    chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
  };
  const meta = payload.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error("Missing price");
  const price = meta.regularMarketPrice;
  const previousClose = typeof meta.chartPreviousClose === "number"
    ? meta.chartPreviousClose
    : typeof meta.previousClose === "number"
      ? meta.previousClose
      : price;
  const change = price - previousClose;
  return {
    symbol: String(meta.symbol || symbol),
    name: String(meta.longName || meta.shortName || companyNames[symbol] || `${symbol} quote`),
    price,
    previousClose,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    currency: String(meta.currency || "USD"),
    exchange: String(meta.exchangeName || meta.fullExchangeName || "US"),
    marketState: String(meta.marketState || "REGULAR"),
    live: true,
    sourceTimestamp: typeof meta.regularMarketTime === "number"
      ? meta.regularMarketTime
      : Math.floor(Date.now() / 1000),
  };
}

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") || "AAPL,MSFT,NVDA")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24))
    .filter(Boolean)
    .slice(0, 24);

  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const quotes = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!quotes.length) {
    return NextResponse.json(
      { error: "Live market data is currently unavailable.", quotes: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const response = NextResponse.json({ quotes, fetchedAt: Date.now() });
  response.headers.set("Cache-Control", "public, s-maxage=1, stale-while-revalidate=1");
  return response;
}
