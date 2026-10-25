import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type YahooSearchQuote = {
  symbol?: unknown;
  shortname?: unknown;
  longname?: unknown;
  quoteType?: unknown;
  exchange?: unknown;
  exchDisp?: unknown;
};

type YahooSearchPayload = {
  quotes?: YahooSearchQuote[];
};

const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
};

function cleanQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function cleanSymbol(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

async function fetchYahooSearch(host: string, query: string) {
  const params = new URLSearchParams({
    q: query,
    quotesCount: "40",
    newsCount: "0",
    listsCount: "0",
    enableFuzzyQuery: "true",
  });
  const upstream = await fetch(`${host}/v1/finance/search?${params}`, {
    cache: "no-store",
    headers: REQUEST_HEADERS,
  });
  if (!upstream.ok) throw new Error(`Yahoo search returned ${upstream.status}`);
  return upstream.json() as Promise<YahooSearchPayload>;
}

export async function GET(request: NextRequest) {
  const query = cleanQuery(request.nextUrl.searchParams.get("q") || "");
  if (query.length < 2) {
    return NextResponse.json({ query, count: 0, results: [] });
  }

  let lastError: unknown;
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const payload = await fetchYahooSearch(host, query);
      const seen = new Set<string>();
      const results = (Array.isArray(payload.quotes) ? payload.quotes : [])
        .filter((quote) => quote.quoteType === "EQUITY")
        .flatMap((quote) => {
          const symbol = cleanSymbol(quote.symbol);
          if (!symbol || seen.has(symbol)) return [];
          seen.add(symbol);
          return [{
            symbol,
            name: String(quote.longname || quote.shortname || symbol),
            exchange: String(quote.exchDisp || quote.exchange || "Global market"),
          }];
        })
        .slice(0, 24);

      const response = NextResponse.json({
        query,
        source: "Yahoo Finance",
        count: results.length,
        results,
      });
      response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("Global ticker search failed", lastError);
  return NextResponse.json(
    { error: "Global stock search is temporarily unavailable.", query, count: 0, results: [] },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
