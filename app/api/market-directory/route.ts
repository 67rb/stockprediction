import { NextRequest, NextResponse } from "next/server";
import { MARKET_DIRECTORY_CATALOG } from "@/lib/market-directory";

export const dynamic = "force-dynamic";

type YahooScreenerQuote = {
  symbol?: unknown;
  shortName?: unknown;
  longName?: unknown;
  displayName?: unknown;
  quoteType?: unknown;
  regularMarketPrice?: unknown;
  regularMarketPreviousClose?: unknown;
  regularMarketChange?: unknown;
  regularMarketChangePercent?: unknown;
  marketCap?: unknown;
  currency?: unknown;
  exchange?: unknown;
  fullExchangeName?: unknown;
  marketState?: unknown;
};

type YahooScreenerPayload = {
  finance?: {
    result?: Array<{
      start?: number;
      count?: number;
      total?: number;
      quotes?: YahooScreenerQuote[];
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type YahooSession = {
  cookie: string;
  crumb: string;
  expiresAt: number;
};

type YahooScreenerResult = {
  start?: number;
  count?: number;
  total?: number;
  quotes: YahooScreenerQuote[];
};

const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
};

let cachedYahooSession: YahooSession | null = null;

function cleanSymbol(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

async function getYahooSession(forceRefresh = false) {
  if (!forceRefresh && cachedYahooSession && cachedYahooSession.expiresAt > Date.now()) {
    return cachedYahooSession;
  }

  const cookieResponse = await fetch("https://fc.yahoo.com/", {
    cache: "no-store",
    headers: REQUEST_HEADERS,
    redirect: "manual",
  });
  const setCookie = cookieResponse.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0]?.trim();
  if (!cookie || !cookie.includes("=")) throw new Error("Yahoo session cookie unavailable");

  const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    cache: "no-store",
    headers: {
      ...REQUEST_HEADERS,
      Cookie: cookie,
    },
  });
  if (!crumbResponse.ok) throw new Error(`Yahoo crumb returned ${crumbResponse.status}`);
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.length > 100) throw new Error("Yahoo crumb unavailable");

  cachedYahooSession = {
    cookie,
    crumb,
    expiresAt: Date.now() + (20 * 60 * 1000),
  };
  return cachedYahooSession;
}

async function fetchDirectoryPage(
  market: { providerRegion: string; name: string },
  offset: number,
  size: number,
  forceSessionRefresh = false,
): Promise<YahooScreenerResult> {
  const session = await getYahooSession(forceSessionRefresh);
  const body = {
    offset,
    size,
    sortField: "ticker",
    sortType: "ASC",
    quoteType: "EQUITY",
    query: {
      operator: "AND",
      operands: [{
        operator: "EQ",
        operands: ["region", market.providerRegion],
      }],
    },
    userId: "",
    userIdType: "guid",
  };
  const params = new URLSearchParams({
    crumb: session.crumb,
    corsDomain: "finance.yahoo.com",
    formatted: "false",
    lang: "en-US",
    region: "US",
  });
  const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener?${params}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...REQUEST_HEADERS,
      "Content-Type": "application/json",
      Cookie: session.cookie,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as YahooScreenerPayload;
  const unauthorized = response.status === 401 || payload.finance?.error?.code === "Unauthorized";
  if (unauthorized && !forceSessionRefresh) {
    cachedYahooSession = null;
    return fetchDirectoryPage(market, offset, size, true);
  }
  if (!response.ok || payload.finance?.error) {
    throw new Error(payload.finance?.error?.description || `Yahoo screener returned ${response.status}`);
  }
  const result = payload.finance?.result?.[0];
  if (!result || !Array.isArray(result.quotes)) throw new Error("Yahoo screener returned no listings");
  return { ...result, quotes: result.quotes };
}

export async function GET(request: NextRequest) {
  const marketId = request.nextUrl.searchParams.get("market") || "south-africa";
  const market = MARKET_DIRECTORY_CATALOG.find((candidate) => candidate.id === marketId);
  if (!market) {
    return NextResponse.json(
      { error: "Unknown market.", listings: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestedOffset = Number(request.nextUrl.searchParams.get("offset") || 0);
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 250);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(250, Math.max(25, Math.floor(requestedLimit)))
    : 250;

  try {
    const result = await fetchDirectoryPage(market, offset, limit);
    const listings = result.quotes.flatMap((quote) => {
      const symbol = cleanSymbol(quote.symbol);
      const price = typeof quote.regularMarketPrice === "number" ? quote.regularMarketPrice : NaN;
      if (!symbol || !Number.isFinite(price)) return [];
      const previousClose = typeof quote.regularMarketPreviousClose === "number"
        ? quote.regularMarketPreviousClose
        : price;
      const change = typeof quote.regularMarketChange === "number"
        ? quote.regularMarketChange
        : price - previousClose;
      return [{
        symbol,
        name: String(quote.longName || quote.shortName || quote.displayName || symbol),
        price,
        previousClose,
        change,
        changePercent: typeof quote.regularMarketChangePercent === "number"
          ? quote.regularMarketChangePercent
          : previousClose ? (change / previousClose) * 100 : 0,
        marketCap: typeof quote.marketCap === "number" ? quote.marketCap : 0,
        currency: typeof quote.currency === "string" ? quote.currency : "",
        exchange: String(quote.fullExchangeName || quote.exchange || market.name),
        marketState: typeof quote.marketState === "string" ? quote.marketState : "UNKNOWN",
      }];
    }).map((listing, index) => ({ ...listing, rank: offset + index + 1 }));

    const response = NextResponse.json({
      marketId,
      marketName: market.name,
      source: "Yahoo Finance regional equity screener",
      fetchedAt: new Date().toISOString(),
      offset,
      count: listings.length,
      providerCount: typeof result.count === "number" ? result.count : listings.length,
      total: typeof result.total === "number" ? result.total : offset + listings.length,
      listings,
    });
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return response;
  } catch (error) {
    console.error(`Market directory failed for ${marketId}`, error);
    return NextResponse.json(
      { error: `${market.name} directory is temporarily unavailable.`, listings: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
