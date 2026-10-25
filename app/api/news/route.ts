import { NextRequest, NextResponse } from "next/server";
import { sanitizeHistorySymbol } from "../yahoo-history";

export const dynamic = "force-dynamic";

type YahooNewsItem = {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  type?: string;
  thumbnail?: {
    resolutions?: Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
  };
  relatedTickers?: string[];
};

type YahooSearchPayload = {
  news?: YahooNewsItem[];
};

type NewsTopic = "Earnings" | "Markets" | "Deals" | "Policy" | "Macro" | "Technology" | "Energy" | "Crypto" | "Company";

const HIGH_SIGNAL_TERMS = [
  "earnings",
  "guidance",
  "forecast",
  "acquisition",
  "merger",
  "takeover",
  "bankruptcy",
  "default",
  "lawsuit",
  "probe",
  "tariff",
  "rate cut",
  "rate hike",
  "dividend",
  "buyback",
  "ceo",
  "ipo",
];

const STOCK_RELEVANCE_TERMS = [
  "stock",
  "stocks",
  "share",
  "shares",
  "equity",
  "equities",
  "wall street",
  "nasdaq",
  "s&p 500",
  "dow jones",
  "investor",
  "investing",
  "trading",
  "earnings",
  "revenue",
  "profit",
  "dividend",
  "analyst",
  "portfolio",
  "futures",
  "bonds",
  "treasury",
  "interest rate",
  "rate cut",
  "rate hike",
  "inflation",
  "federal reserve",
  "the fed",
  "economy",
  "economic",
  "merger",
  "acquisition",
  "takeover",
  "ipo",
  "guidance",
  "market cap",
];

const SYMBOL_NEWS_TERMS: Record<string, string[]> = {
  XAUUSD: ["gold", "bullion", "xau"],
  "^GSPC": ["s&p 500", "s&p500"],
  "^DJI": ["dow jones", "dow industrials"],
  "^IXIC": ["nasdaq", "nasdaq composite"],
  "BTC-USD": ["bitcoin", "btc"],
  "ETH-USD": ["ethereum", "ether", "eth"],
};

const TOPIC_RULES: Array<{ topic: NewsTopic; terms: string[] }> = [
  { topic: "Earnings", terms: ["earnings", "revenue", "profit", "guidance", "quarter", "results", "sales"] },
  { topic: "Deals", terms: ["acquisition", "merger", "takeover", "deal", "buyout", "stake", "bid"] },
  { topic: "Policy", terms: ["regulator", "regulation", "lawsuit", "court", "probe", "sec ", "antitrust", "tariff"] },
  { topic: "Macro", terms: ["inflation", "interest rate", "rate cut", "rate hike", "fed ", "economy", "gdp", "jobs report"] },
  { topic: "Technology", terms: ["artificial intelligence", " ai ", "chip", "semiconductor", "software", "cloud", "cyber"] },
  { topic: "Energy", terms: ["oil", "gas", "gold", "copper", "energy", "mining", "opec", "commodity"] },
  { topic: "Crypto", terms: ["bitcoin", "ethereum", "crypto", "blockchain", "token"] },
  { topic: "Markets", terms: ["stock market", "stocks", "shares", "index", "futures", "bonds", "treasury", "wall street"] },
];

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function newsQueryFor(symbol: string) {
  if (symbol === "MARKET") return "stock market";
  if (symbol === "XAUUSD") return "gold price";
  return symbol;
}

function titleKey(title: string) {
  return title
    .toLowerCase()
    .replace(/\b(update|breaking|analysis|exclusive|live)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleTokens(title: string) {
  return new Set(titleKey(title)
    .split(" ")
    .filter((token) => token.length > 2)
    .filter((token) => !["the", "and", "for", "with", "from", "that", "this", "after", "says"].includes(token)));
}

function isNearDuplicate(title: string, comparison: string) {
  const left = titleTokens(title);
  const right = titleTokens(comparison);
  if (!left.size || !right.size) return false;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return shared / Math.min(left.size, right.size) >= 0.72;
}

function classifyTopic(title: string): NewsTopic {
  const searchable = ` ${title.toLowerCase()} `;
  return TOPIC_RULES.find((rule) => rule.terms.some((term) => searchable.includes(term)))?.topic || "Company";
}

function isHighSignal(title: string) {
  const searchable = title.toLowerCase();
  return HIGH_SIGNAL_TERMS.some((term) => searchable.includes(term));
}

function mentionsTicker(title: string, symbol: string) {
  const searchable = title.toLowerCase();
  const aliases = SYMBOL_NEWS_TERMS[symbol] || [];
  if (aliases.some((alias) => searchable.includes(alias))) return true;
  const cleanSymbol = symbol.replace(/[^A-Z0-9]/g, "");
  if (cleanSymbol.length < 3) return false;
  const escaped = cleanSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])\\$?${escaped}([^A-Z0-9]|$)`, "i").test(title);
}

function isStockRelevant(title: string, relatedTickers: string[]) {
  if (relatedTickers.length) return true;
  const searchable = title.toLowerCase();
  return STOCK_RELEVANCE_TERMS.some((term) => searchable.includes(term));
}

export async function GET(request: NextRequest) {
  const rawSymbol = request.nextUrl.searchParams.get("symbol") || "MARKET";
  const symbol = rawSymbol.toUpperCase() === "MARKET"
    ? "MARKET"
    : sanitizeHistorySymbol(rawSymbol);

  try {
    if (!symbol) throw new Error("Missing news symbol");
    const params = new URLSearchParams({
      q: newsQueryFor(symbol),
      quotesCount: "0",
      newsCount: "50",
      enableFuzzyQuery: "false",
    });

    let payload: YahooSearchPayload | null = null;
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
      const upstream = await fetch(`https://${host}/v1/finance/search?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
        },
      });
      if (upstream.ok) {
        payload = await upstream.json() as YahooSearchPayload;
        break;
      }
    }
    if (!payload?.news?.length) throw new Error("News provider unavailable");

    const filterTicker = symbol === "XAUUSD" ? "GC=F" : symbol;
    const allArticles = payload.news.flatMap((item) => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const url = safeHttpUrl(item.link);
      const publishedAt = typeof item.providerPublishTime === "number"
        ? item.providerPublishTime
        : 0;
      if (!title || !url || !publishedAt) return [];
      const thumbnails = item.thumbnail?.resolutions || [];
      const thumbnail = thumbnails
        .map((resolution) => safeHttpUrl(resolution.url))
        .find(Boolean) || null;
      const relatedTickers = Array.isArray(item.relatedTickers)
        ? [...new Set(item.relatedTickers
            .filter((ticker): ticker is string => typeof ticker === "string")
            .map((ticker) => ticker.trim().toUpperCase())
            .filter(Boolean))]
            .slice(0, 8)
        : [];
      const directMatch = symbol !== "MARKET" && (
        relatedTickers.includes(filterTicker)
        || mentionsTicker(title, symbol)
      );
      const publisher = typeof item.publisher === "string" && item.publisher.trim()
        ? item.publisher.trim()
        : "Market news";
      const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - publishedAt);
      const headlineSignalCount = HIGH_SIGNAL_TERMS.filter((term) => title.toLowerCase().includes(term)).length;
      const financialTermCount = STOCK_RELEVANCE_TERMS.filter((term) => title.toLowerCase().includes(term)).length;
      const freshness = ageSeconds <= 3_600
        ? "breaking" as const
        : ageSeconds <= 21_600
          ? "fresh" as const
          : "standard" as const;
      const recencyScore = Math.max(0, 12 - Math.floor(ageSeconds / 7_200));
      const rankScore = (
        (directMatch ? 30 : 0)
        + Math.min(12, headlineSignalCount * 6)
        + Math.min(8, financialTermCount * 2)
        + Math.min(6, relatedTickers.length)
        + recencyScore
        + (thumbnail ? 1 : 0)
      );
      return [{
        id: item.uuid || titleKey(title),
        title,
        publisher,
        url,
        publishedAt,
        thumbnail,
        relatedTickers,
        topic: classifyTopic(title),
        priority: isHighSignal(title) ? "high" as const : "standard" as const,
        directMatch,
        stockRelevant: isStockRelevant(title, relatedTickers),
        freshness,
        rankScore,
      }];
    });

    const relevantArticles = symbol === "MARKET"
      ? allArticles.filter((article) => article.stockRelevant)
      : allArticles.filter((article) => article.directMatch);
    const selected = relevantArticles;
    const sorted = [...selected].sort((left, right) => {
      if (left.rankScore !== right.rankScore) return right.rankScore - left.rankScore;
      return right.publishedAt - left.publishedAt;
    });

    const refinedArticles = sorted.reduce<typeof sorted>((refined, article) => {
      const duplicate = refined.some((existing) => (
        existing.url === article.url
        || titleKey(existing.title) === titleKey(article.title)
        || isNearDuplicate(existing.title, article.title)
      ));
      if (!duplicate) refined.push(article);
      return refined;
    }, []);
    const publisherCounts = new Map<string, number>();
    const preferred = refinedArticles.filter((article) => {
      const count = publisherCounts.get(article.publisher) || 0;
      if (count >= 6) return false;
      publisherCounts.set(article.publisher, count + 1);
      return true;
    });
    const preferredIds = new Set(preferred.map((article) => article.id));
    const articles = [
      ...preferred,
      ...refinedArticles.filter((article) => !preferredIds.has(article.id)),
    ].slice(0, 24);

    const publisherCount = new Set(articles.map((article) => article.publisher)).size;
    const highSignalCount = articles.filter((article) => article.priority === "high").length;
    const breakingCount = articles.filter((article) => article.freshness === "breaking").length;
    const response = NextResponse.json({
      symbol,
      query: newsQueryFor(symbol),
      source: "Yahoo Finance",
      fetchedAt: Math.floor(Date.now() / 1000),
      stats: {
        storyCount: articles.length,
        publisherCount,
        highSignalCount,
        breakingCount,
        duplicatesRemoved: Math.max(0, selected.length - refinedArticles.length),
        discardedIrrelevant: Math.max(0, allArticles.length - relevantArticles.length),
      },
      articles,
    });
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Market news is currently unavailable for that ticker." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
