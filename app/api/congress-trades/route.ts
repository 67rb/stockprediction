import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAPITOL_EXPOSED_URL = "https://www.capitolexposed.com/api/v1/export/trades?days=30&format=json";
const BARGO_BASE = "https://www.bargo.ai/free-apis/congress/v1";
const OFFICIAL_HOUSE_PORTAL = "https://disclosures-clerk.house.gov/FinancialDisclosure";
const OFFICIAL_SENATE_PORTAL = "https://efdsearch.senate.gov/search/home/";

type UpstreamTrade = {
  member?: unknown;
  member_slug?: unknown;
  chamber?: unknown;
  state?: unknown;
  ticker?: unknown;
  asset?: unknown;
  type?: unknown;
  amount_low?: unknown;
  amount_high?: unknown;
  amount_range?: unknown;
  transaction_date?: unknown;
  disclosure_date?: unknown;
  est_price?: unknown;
  recent_price?: unknown;
  recent_price_date?: unknown;
  perf_pct?: unknown;
  realized_return_pct?: unknown;
  outcome?: unknown;
  filing_portal?: unknown;
};

type CapitolExposedTrade = {
  id?: unknown;
  member_name?: unknown;
  chamber?: unknown;
  state?: unknown;
  ticker?: unknown;
  asset_description?: unknown;
  transaction_type?: unknown;
  transaction_date?: unknown;
  disclosure_date?: unknown;
  amount_min?: unknown;
  amount_max?: unknown;
};

type UpstreamStats = {
  totals?: { trades?: unknown; members?: unknown; tickers?: unknown; buys?: unknown; sells?: unknown };
  latest_disclosure?: unknown;
  most_traded_90d?: Array<{
    ticker?: unknown;
    trades?: unknown;
    buys?: unknown;
    sells?: unknown;
    members?: unknown;
  }>;
};

type ProviderPayload = {
  source: string;
  sourceNote: string;
  rawTrades: UpstreamTrade[];
  totals?: UpstreamStats["totals"];
  latestDisclosure?: unknown;
  trending?: UpstreamStats["most_traded_90d"];
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function number(value: unknown, fallback = 0) {
  return optionalNumber(value) ?? fallback;
}

function isoDate(value: unknown) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function dateLagDays(transactionDate: string, disclosureDate: string) {
  const transaction = Date.parse(`${transactionDate}T00:00:00Z`);
  const disclosure = Date.parse(`${disclosureDate}T00:00:00Z`);
  if (!Number.isFinite(transaction) || !Number.isFinite(disclosure)) return 0;
  return Math.max(0, Math.round((disclosure - transaction) / 86_400_000));
}

function filingPortal(value: unknown, chamber: "house" | "senate") {
  const candidate = text(value);
  try {
    const url = new URL(candidate);
    if (
      url.protocol === "https:"
      && ["disclosures-clerk.house.gov", "efdsearch.senate.gov"].includes(url.hostname)
    ) return url.toString();
  } catch {
    // Fall back to the appropriate official search portal.
  }
  return chamber === "senate" ? OFFICIAL_SENATE_PORTAL : OFFICIAL_HOUSE_PORTAL;
}

function normalizeType(value: unknown) {
  const candidate = text(value).toLowerCase();
  if (candidate.includes("purchase") || candidate.includes("buy")) return "purchase" as const;
  if (candidate.includes("sale") || candidate.includes("sell")) return "sale" as const;
  if (candidate.includes("exchange")) return "exchange" as const;
  return "other" as const;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: "\"" };
  return value.replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|quot);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return named[entity.toLowerCase()] || match;
  });
}

function cleanAsset(value: string, fallback: string) {
  const decoded = decodeHtmlEntities(value || fallback).replace(/\s+/g, " ").trim();
  if (!decoded) return fallback;
  if (/[^\u0020-\u007e]/.test(decoded) && decoded.includes(":")) {
    return decoded.split(":").at(-1)?.trim() || fallback;
  }
  return decoded;
}

function normalizeTrade(raw: UpstreamTrade, index: number) {
  const chamber = text(raw.chamber).toLowerCase() === "senate" ? "senate" as const : "house" as const;
  const transactionDate = isoDate(raw.transaction_date);
  const disclosureDate = isoDate(raw.disclosure_date);
  const lagDays = dateLagDays(transactionDate, disclosureDate);
  const amountLow = Math.max(0, number(raw.amount_low));
  const amountHigh = Math.max(amountLow, number(raw.amount_high, amountLow));
  const amountMidpoint = amountHigh ? (amountLow + amountHigh) / 2 : amountLow;
  const performancePercent = optionalNumber(raw.perf_pct);
  const flags: string[] = [];

  if (lagDays > 45) flags.push(`Filed ${lagDays} days after the transaction`);
  if (amountHigh >= 1_000_000) flags.push("Top disclosed value range");
  else if (amountHigh >= 250_000) flags.push("Large disclosed value range");
  if (performancePercent !== null && Math.abs(performancePercent) >= 20) flags.push("20%+ move since transaction");
  else if (performancePercent !== null && Math.abs(performancePercent) >= 10) flags.push("10%+ move since transaction");

  const attentionScore = Math.min(100, Math.round(
    (lagDays > 45 ? 45 : lagDays > 30 ? 20 : 0)
    + (amountHigh >= 1_000_000 ? 35 : amountHigh >= 250_000 ? 25 : amountHigh >= 50_000 ? 12 : 0)
    + (performancePercent !== null && Math.abs(performancePercent) >= 20
      ? 20
      : performancePercent !== null && Math.abs(performancePercent) >= 10 ? 10 : 0),
  ));

  const member = text(raw.member, "Unknown filer");
  const ticker = text(raw.ticker, "N/A").toUpperCase().slice(0, 20);
  return {
    id: [text(raw.member_slug, member), ticker, transactionDate, disclosureDate, index].join("-"),
    member,
    memberSlug: text(raw.member_slug),
    chamber,
    state: text(raw.state, "—"),
    ticker,
    asset: cleanAsset(text(raw.asset), ticker),
    type: normalizeType(raw.type),
    amountLow,
    amountHigh,
    amountMidpoint,
    amountRange: text(raw.amount_range, amountHigh ? `$${amountLow.toLocaleString()} – $${amountHigh.toLocaleString()}` : "Not specified"),
    transactionDate,
    disclosureDate,
    filingLagDays: lagDays,
    estimatedPrice: number(raw.est_price),
    recentPrice: number(raw.recent_price),
    recentPriceDate: isoDate(raw.recent_price_date),
    performancePercent,
    realizedReturnPercent: optionalNumber(raw.realized_return_pct),
    outcome: text(raw.outcome, "unclassified"),
    filingPortal: filingPortal(raw.filing_portal, chamber),
    flags,
    attentionScore,
    attention: attentionScore >= 55 ? "high" as const : attentionScore >= 20 ? "review" as const : "routine" as const,
  };
}

async function fetchCapitolExposed(): Promise<ProviderPayload> {
  const response = await fetch(CAPITOL_EXPOSED_URL, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "LedgerMarketDashboard/1.0" },
  });
  if (!response.ok) throw new Error(`CapitolExposed returned ${response.status}`);
  const payload = await response.json() as { data?: CapitolExposedTrade[] };
  if (!Array.isArray(payload.data) || !payload.data.length) throw new Error("CapitolExposed returned no trades");
  return {
    source: "CapitolExposed",
    sourceNote: "Public STOCK Act records · resilient live feed",
    rawTrades: payload.data.map((trade) => ({
      member: trade.member_name,
      member_slug: trade.id,
      chamber: trade.chamber,
      state: trade.state,
      ticker: trade.ticker,
      asset: trade.asset_description,
      type: trade.transaction_type,
      amount_low: trade.amount_min,
      amount_high: trade.amount_max,
      transaction_date: trade.transaction_date,
      disclosure_date: trade.disclosure_date,
    })),
  };
}

async function fetchBargo(): Promise<ProviderPayload> {
  async function fetchJson<T>(path: string) {
    const response = await fetch(`${BARGO_BASE}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "LedgerMarketDashboard/1.0" },
    });
    if (!response.ok) throw new Error(`Bargo returned ${response.status}`);
    return response.json() as Promise<T>;
  }
  const [feed, stats] = await Promise.all([
    fetchJson<{ trades?: UpstreamTrade[] }>("/trades?limit=100&page=0"),
    fetchJson<UpstreamStats>("/stats"),
  ]);
  if (!Array.isArray(feed.trades) || !feed.trades.length) throw new Error("Bargo returned no trades");
  return {
    source: "Bargo Congress API",
    sourceNote: "Public STOCK Act records · backup live feed",
    rawTrades: feed.trades,
    totals: stats.totals,
    latestDisclosure: stats.latest_disclosure,
    trending: stats.most_traded_90d,
  };
}

function summarizeTrades(trades: ReturnType<typeof normalizeTrade>[]) {
  const tickerMap = new Map<string, { ticker: string; trades: number; buys: number; sells: number; members: Set<string> }>();
  trades.forEach((trade) => {
    if (trade.ticker === "N/A") return;
    const item = tickerMap.get(trade.ticker) || { ticker: trade.ticker, trades: 0, buys: 0, sells: 0, members: new Set<string>() };
    item.trades += 1;
    if (trade.type === "purchase") item.buys += 1;
    if (trade.type === "sale") item.sells += 1;
    item.members.add(trade.member);
    tickerMap.set(trade.ticker, item);
  });
  return [...tickerMap.values()]
    .sort((left, right) => right.trades - left.trades || right.members.size - left.members.size)
    .slice(0, 12)
    .map((item) => ({ ...item, members: item.members.size }));
}

export async function GET(request: NextRequest) {
  try {
    let provider: ProviderPayload;
    try {
      provider = await fetchCapitolExposed();
    } catch (primaryError) {
      console.warn("Primary Congress disclosure feed unavailable", primaryError);
      provider = await fetchBargo();
    }

    const allTrades = provider.rawTrades
      .map(normalizeTrade)
      .filter((trade) => trade.transactionDate && trade.disclosureDate);
    const ticker = text(request.nextUrl.searchParams.get("ticker")).toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 20);
    const chamber = text(request.nextUrl.searchParams.get("chamber")).toLowerCase();
    const type = text(request.nextUrl.searchParams.get("type")).toLowerCase();
    const trades = allTrades
      .filter((trade) => !ticker || trade.ticker === ticker)
      .filter((trade) => !["house", "senate"].includes(chamber) || trade.chamber === chamber)
      .filter((trade) => !["purchase", "sale"].includes(type) || trade.type === type)
      .slice(0, 150);
    const latestDisclosure = isoDate(provider.latestDisclosure)
      || allTrades.map((trade) => trade.disclosureDate).sort().at(-1)
      || "";
    const computedTotals = {
      trades: allTrades.length,
      members: new Set(allTrades.map((trade) => trade.member)).size,
      tickers: new Set(allTrades.map((trade) => trade.ticker).filter((item) => item !== "N/A")).size,
      buys: allTrades.filter((trade) => trade.type === "purchase").length,
      sells: allTrades.filter((trade) => trade.type === "sale").length,
    };

    const response = NextResponse.json({
      source: provider.source,
      sourceNote: provider.sourceNote,
      fetchedAt: new Date().toISOString(),
      latestDisclosure,
      count: trades.length,
      totals: provider.totals ? {
        trades: number(provider.totals.trades, computedTotals.trades),
        members: number(provider.totals.members, computedTotals.members),
        tickers: number(provider.totals.tickers, computedTotals.tickers),
        buys: number(provider.totals.buys, computedTotals.buys),
        sells: number(provider.totals.sells, computedTotals.sells),
      } : computedTotals,
      trending: Array.isArray(provider.trending)
        ? provider.trending.slice(0, 12).map((item) => ({
            ticker: text(item.ticker, "N/A").toUpperCase(),
            trades: number(item.trades),
            buys: number(item.buys),
            sells: number(item.sells),
            members: number(item.members),
          }))
        : summarizeTrades(allTrades),
      trades,
      officialSources: { house: OFFICIAL_HOUSE_PORTAL, senate: OFFICIAL_SENATE_PORTAL },
    });
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
    return response;
  } catch (error) {
    console.error("Congress trade feeds failed", error);
    return NextResponse.json(
      { error: "Congressional disclosure data is temporarily unavailable.", trades: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
