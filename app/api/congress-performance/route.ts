import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: unknown;
        currency?: unknown;
        regularMarketPrice?: unknown;
        regularMarketTime?: unknown;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
};

function validNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isoDateFromTimestamp(timestamp: number) {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

function sanitizeSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

function sanitizeDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

async function fetchPerformance(symbol: string, purchaseDate: string) {
  const start = Math.floor(Date.parse(`${purchaseDate}T00:00:00Z`) / 1_000);
  const end = Math.floor(Date.now() / 1_000) + 86_400;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(start));
  url.searchParams.set("period2", String(end));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
    },
  });
  if (!response.ok) throw new Error(`Market history returned ${response.status}`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const firstIndex = timestamps.findIndex((timestamp, index) => (
    timestamp >= start && (validNumber(adjustedCloses[index]) !== null || validNumber(closes[index]) !== null)
  ));
  if (!result?.meta || firstIndex < 0) throw new Error("No matching market session");

  const referencePrice = validNumber(adjustedCloses[firstIndex]) ?? validNumber(closes[firstIndex]);
  const lastSeriesPrice = [...adjustedCloses, ...closes].reverse().find((value) => validNumber(value) !== null);
  const currentPrice = validNumber(result.meta.regularMarketPrice) ?? validNumber(lastSeriesPrice);
  if (referencePrice === null || currentPrice === null) throw new Error("Price comparison unavailable");

  return {
    symbol: String(result.meta.symbol || symbol),
    purchaseDate,
    referenceDate: isoDateFromTimestamp(timestamps[firstIndex]),
    referencePrice,
    currentPrice,
    currentPriceTime: typeof result.meta.regularMarketTime === "number" ? result.meta.regularMarketTime : null,
    currency: typeof result.meta.currency === "string" ? result.meta.currency : "USD",
    change: currentPrice - referencePrice,
    changePercent: ((currentPrice / referencePrice) - 1) * 100,
    methodology: "Latest quote versus the split/dividend-adjusted close on the disclosed transaction date, or the next available market session.",
  };
}

export async function GET(request: NextRequest) {
  const requestedSymbol = sanitizeSymbol(request.nextUrl.searchParams.get("symbol") || "");
  const purchaseDate = sanitizeDate(request.nextUrl.searchParams.get("date") || "");
  if (!requestedSymbol || !purchaseDate || Date.parse(`${purchaseDate}T00:00:00Z`) > Date.now()) {
    return NextResponse.json({ error: "A valid ticker and past purchase date are required." }, { status: 400 });
  }

  const symbols = [requestedSymbol, requestedSymbol.replace(/\.([A-Z])$/, "-$1")]
    .filter((symbol, index, items) => items.indexOf(symbol) === index);
  for (const symbol of symbols) {
    try {
      const result = await fetchPerformance(symbol, purchaseDate);
      const response = NextResponse.json(result);
      response.headers.set("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
      return response;
    } catch {
      // Try Yahoo's alternate share-class symbol before returning unavailable.
    }
  }

  return NextResponse.json(
    { error: "Historical performance is unavailable for this disclosed asset." },
    { status: 503, headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
