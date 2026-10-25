import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type YahooQuote = {
  symbol?: unknown;
  shortName?: unknown;
  longName?: unknown;
  displayName?: unknown;
  regularMarketPrice?: unknown;
  regularMarketChangePercent?: unknown;
  marketCap?: unknown;
  currency?: unknown;
  exchange?: unknown;
  fullExchangeName?: unknown;
  quoteType?: unknown;
  marketState?: unknown;
};

type YahooScreenerPayload = {
  finance?: {
    result?: Array<{
      quotes?: YahooQuote[];
    }>;
  };
};

const SCREENER_PATH = "/v1/finance/screener/predefined/saved";
const SCREENER_PARAMS = new URLSearchParams({
  formatted: "false",
  lang: "en-US",
  region: "US",
  scrIds: "largest_market_cap",
  count: "50",
  start: "0",
});

async function fetchLargestStocks(host: string) {
  const upstream = await fetch(`${host}${SCREENER_PATH}?${SCREENER_PARAMS}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
    },
  });
  if (!upstream.ok) throw new Error(`Yahoo screener returned ${upstream.status}`);

  const payload = await upstream.json() as YahooScreenerPayload;
  const quotes = payload.finance?.result?.[0]?.quotes;
  if (!Array.isArray(quotes)) throw new Error("Yahoo screener returned no results");

  const stocks = quotes
    .filter((quote) => quote.quoteType === "EQUITY")
    .flatMap((quote) => {
      const symbol = typeof quote.symbol === "string" ? quote.symbol : "";
      const price = typeof quote.regularMarketPrice === "number" ? quote.regularMarketPrice : NaN;
      const marketCap = typeof quote.marketCap === "number" ? quote.marketCap : NaN;
      if (!symbol || !Number.isFinite(price) || !Number.isFinite(marketCap) || marketCap <= 0) {
        return [];
      }

      return [{
        symbol,
        name: String(quote.longName || quote.shortName || quote.displayName || symbol),
        price,
        changePercent: typeof quote.regularMarketChangePercent === "number"
          ? quote.regularMarketChangePercent
          : 0,
        marketCap,
        currency: typeof quote.currency === "string" ? quote.currency : "USD",
        exchange: String(quote.fullExchangeName || quote.exchange || "U.S. market"),
        marketState: typeof quote.marketState === "string" ? quote.marketState : "UNKNOWN",
      }];
    })
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 50)
    .map((stock, index) => ({ ...stock, rank: index + 1 }));

  if (!stocks.length) throw new Error("Yahoo screener returned no usable equities");
  return stocks;
}

export async function GET() {
  let lastError: unknown;
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const stocks = await fetchLargestStocks(host);
      const response = NextResponse.json({
        source: "Yahoo Finance",
        screen: "largest_market_cap",
        fetchedAt: new Date().toISOString(),
        count: stocks.length,
        stocks,
      });
      response.headers.set("Cache-Control", "public, s-maxage=1, stale-while-revalidate=4");
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("Mega-cap screener failed", lastError);
  return NextResponse.json(
    { error: "The live market-cap screen is temporarily unavailable.", stocks: [] },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
