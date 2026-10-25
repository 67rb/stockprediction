import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAPITOL_EXPOSED_BASE = "https://www.capitolexposed.com/api/v1";
const FEATURED_SLUG = "nancy-pelosi";
const OFFICIAL_HOUSE_PORTAL = "https://disclosures-clerk.house.gov/FinancialDisclosure";
const OFFICIAL_SENATE_PORTAL = "https://efdsearch.senate.gov/search/home/";

type ProviderMember = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  party?: unknown;
  state?: unknown;
  district?: unknown;
  chamber?: unknown;
  image_url?: unknown;
  in_office?: unknown;
  trade_count?: unknown;
  conflict_trades?: unknown;
  avg_conflict?: unknown;
  avg_conflict_score?: unknown;
  latest_trade?: unknown;
  website?: unknown;
  term_start?: unknown;
  term_end?: unknown;
};

type ProviderTrade = {
  id?: unknown;
  ticker?: unknown;
  asset_description?: unknown;
  transaction_type?: unknown;
  transaction_date?: unknown;
  disclosure_date?: unknown;
  amount_min?: unknown;
  amount_max?: unknown;
  owner?: unknown;
  conflict_score?: unknown;
  conflict_flags?: unknown;
  source_url?: unknown;
};

type Envelope<T> = {
  status?: unknown;
  data?: T;
  meta?: { total?: unknown; page?: unknown; per_page?: unknown; has_more?: unknown; timestamp?: unknown };
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isoDate(value: unknown) {
  const candidate = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function safeUrl(value: unknown, allowedHosts?: string[]) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:") return "";
    if (allowedHosts && !allowedHosts.includes(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function fetchProvider<T>(path: string) {
  const response = await fetch(`${CAPITOL_EXPOSED_BASE}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "LedgerMarketDashboard/1.0" },
  });
  if (!response.ok) throw new Error(`Congress member provider returned ${response.status}`);
  const payload = await response.json() as Envelope<T>;
  if (payload.status !== "success" || payload.data === undefined) throw new Error("Congress member provider returned no data");
  return payload;
}

function normalizedMember(member: ProviderMember, rank = 0, featured = false) {
  const name = text(member.name, "Unknown filer");
  const slug = text(member.slug, slugify(name));
  return {
    rank,
    featured,
    slug,
    name,
    party: text(member.party, "—"),
    state: text(member.state, "—"),
    district: text(member.district),
    chamber: text(member.chamber).toLowerCase() === "senate" ? "senate" as const : "house" as const,
    imageUrl: safeUrl(member.image_url, ["bioguide.congress.gov"]),
    inOffice: member.in_office !== false,
    tradeCount: number(member.trade_count),
    conflictTrades: number(member.conflict_trades),
    averageConflict: number(member.avg_conflict ?? member.avg_conflict_score),
    latestTrade: isoDate(member.latest_trade),
    website: safeUrl(member.website),
    termStart: isoDate(member.term_start),
    termEnd: isoDate(member.term_end),
  };
}

async function rankingResponse() {
  const [rankingEnvelope, featuredEnvelope] = await Promise.all([
    fetchProvider<ProviderMember[]>("/top-traders?limit=30"),
    fetchProvider<ProviderMember>(`/members/${FEATURED_SLUG}`),
  ]);
  const ranking = Array.isArray(rankingEnvelope.data) ? rankingEnvelope.data : [];
  const currentCutoff = `${new Date().getUTCFullYear() - 1}-01-01`;
  const activeLeaders = ranking
    .filter((member) => text(member.slug) !== FEATURED_SLUG)
    .filter((member) => isoDate(member.latest_trade) >= currentCutoff)
    .slice(0, 9);
  const members = [featuredEnvelope.data, ...activeLeaders]
    .map((member, index) => normalizedMember(member, index + 1, index === 0));
  return NextResponse.json({
    source: "CapitolExposed",
    fetchedAt: new Date().toISOString(),
    methodology: "Nancy Pelosi is the featured profile; remaining active members are ordered by the provider's disclosed transaction count.",
    members,
  }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } });
}

function normalizeTrade(trade: ProviderTrade, chamber: "house" | "senate") {
  const transactionDate = isoDate(trade.transaction_date);
  const disclosureDate = isoDate(trade.disclosure_date);
  const transactionTime = Date.parse(`${transactionDate}T00:00:00Z`);
  const disclosureTime = Date.parse(`${disclosureDate}T00:00:00Z`);
  const filingLagDays = Number.isFinite(transactionTime) && Number.isFinite(disclosureTime)
    ? Math.max(0, Math.round((disclosureTime - transactionTime) / 86_400_000))
    : 0;
  const amountLow = Math.max(0, number(trade.amount_min));
  const amountHigh = Math.max(amountLow, number(trade.amount_max, amountLow));
  const sourceUrl = safeUrl(trade.source_url, ["disclosures-clerk.house.gov", "efdsearch.senate.gov"])
    || (chamber === "senate" ? OFFICIAL_SENATE_PORTAL : OFFICIAL_HOUSE_PORTAL);
  const typeValue = text(trade.transaction_type).toLowerCase();
  const type = typeValue.includes("purchase") || typeValue.includes("buy")
    ? "purchase" as const
    : typeValue.includes("sale") || typeValue.includes("sell")
      ? "sale" as const
      : "exchange" as const;
  return {
    id: text(trade.id, `${transactionDate}-${text(trade.ticker)}-${amountHigh}`),
    ticker: text(trade.ticker, "N/A").toUpperCase(),
    asset: text(trade.asset_description, text(trade.ticker, "Unmapped asset")).replace(/\s+/g, " "),
    type,
    transactionDate,
    disclosureDate,
    filingLagDays,
    amountLow,
    amountHigh,
    amountMidpoint: amountHigh ? (amountLow + amountHigh) / 2 : amountLow,
    amountRange: amountHigh ? `$${amountLow.toLocaleString()} – $${amountHigh.toLocaleString()}` : "Not specified",
    owner: text(trade.owner, "not specified").toLowerCase(),
    conflictScore: number(trade.conflict_score),
    conflictFlags: Array.isArray(trade.conflict_flags)
      ? trade.conflict_flags.filter((flag): flag is string => typeof flag === "string").slice(0, 10)
      : [],
    sourceUrl,
  };
}

async function memberResponse(slug: string) {
  const [memberEnvelope, firstTradesEnvelope] = await Promise.all([
    fetchProvider<ProviderMember>(`/members/${slug}`),
    fetchProvider<ProviderTrade[]>(`/members/${slug}/trades?per_page=100&page=1`),
  ]);
  const total = Math.max(0, number(firstTradesEnvelope.meta?.total));
  const pageCount = Math.min(25, Math.max(1, Math.ceil(total / 100)));
  const additionalPages = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
        fetchProvider<ProviderTrade[]>(`/members/${slug}/trades?per_page=100&page=${index + 2}`)
      )))
    : [];
  const rawTrades = [
    ...(Array.isArray(firstTradesEnvelope.data) ? firstTradesEnvelope.data : []),
    ...additionalPages.flatMap((page) => Array.isArray(page.data) ? page.data : []),
  ];
  const member = normalizedMember(memberEnvelope.data);
  const normalizedTrades = rawTrades
    .map((trade) => normalizeTrade(trade, member.chamber))
    .filter((trade) => trade.transactionDate && trade.disclosureDate);
  const seenTradeIds = new Set<string>();
  const trades = normalizedTrades
    .filter((trade) => {
      if (seenTradeIds.has(trade.id)) return false;
      seenTradeIds.add(trade.id);
      return true;
    })
    .sort((left, right) => right.transactionDate.localeCompare(left.transactionDate));
  const duplicateRecordsRemoved = normalizedTrades.length - trades.length;
  const positionMap = new Map<string, {
    ticker: string;
    marketSymbol: string;
    asset: string;
    purchases: number;
    sales: number;
    purchaseCount: number;
    saleCount: number;
    latestPurchaseDate: string;
    latestAction: string;
    latestDate: string;
    owners: Set<string>;
  }>();
  trades.forEach((trade) => {
    if (trade.ticker === "N/A") return;
    const position = positionMap.get(trade.ticker) || {
      ticker: trade.ticker,
      marketSymbol: trade.ticker.replace(/\.([A-Z])$/, "-$1"),
      asset: trade.asset,
      purchases: 0,
      sales: 0,
      purchaseCount: 0,
      saleCount: 0,
      latestPurchaseDate: "",
      latestAction: trade.type,
      latestDate: trade.transactionDate,
      owners: new Set<string>(),
    };
    if (trade.type === "purchase") {
      position.purchases += trade.amountMidpoint;
      position.purchaseCount += 1;
      if (trade.transactionDate > position.latestPurchaseDate) {
        position.latestPurchaseDate = trade.transactionDate;
      }
    } else if (trade.type === "sale") {
      position.sales += trade.amountMidpoint;
      position.saleCount += 1;
    }
    if (trade.transactionDate > position.latestDate) {
      position.latestAction = trade.type;
      position.latestDate = trade.transactionDate;
    }
    position.owners.add(trade.owner);
    positionMap.set(trade.ticker, position);
  });
  const positions = [...positionMap.values()]
    .map((position) => ({
      ...position,
      grossFlow: position.purchases + position.sales,
      netFlow: position.purchases - position.sales,
      owners: [...position.owners],
    }))
    .sort((left, right) => Math.abs(right.netFlow) - Math.abs(left.netFlow) || right.grossFlow - left.grossFlow);
  const purchaseTrades = trades.filter((trade) => trade.type === "purchase");
  const saleTrades = trades.filter((trade) => trade.type === "sale");
  const grossVolume = trades.reduce((sum, trade) => sum + trade.amountMidpoint, 0);
  const averageLag = trades.length
    ? Math.round(trades.reduce((sum, trade) => sum + trade.filingLagDays, 0) / trades.length)
    : 0;

  return NextResponse.json({
    source: "CapitolExposed",
    fetchedAt: new Date().toISOString(),
    member: { ...member, tradeCount: total || member.tradeCount },
    summary: {
      trades: trades.length,
      assets: positions.length,
      grossVolume,
      purchaseVolume: purchaseTrades.reduce((sum, trade) => sum + trade.amountMidpoint, 0),
      saleVolume: saleTrades.reduce((sum, trade) => sum + trade.amountMidpoint, 0),
      purchaseCount: purchaseTrades.length,
      saleCount: saleTrades.length,
      averageLag,
      lateFilings: trades.filter((trade) => trade.filingLagDays > 45).length,
      firstTrade: trades.at(-1)?.transactionDate || "",
      latestTrade: trades[0]?.transactionDate || "",
      owners: [...new Set(trades.map((trade) => trade.owner))],
      complete: rawTrades.length >= total,
      sourceRecords: normalizedTrades.length,
      duplicateRecordsRemoved,
    },
    positions,
    trades,
    note: `Positions are estimated from disclosed transaction-range midpoints. They are not a brokerage statement, exact holdings, cost basis, or current market value.${duplicateRecordsRemoved ? ` ${duplicateRecordsRemoved} exact duplicate provider record${duplicateRecordsRemoved === 1 ? " was" : "s were"} removed before calculation.` : ""}`,
  }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } });
}

export async function GET(request: NextRequest) {
  const slug = text(request.nextUrl.searchParams.get("slug")).toLowerCase();
  try {
    if (!slug) return rankingResponse();
    if (!/^[a-z0-9-]{2,80}$/.test(slug)) {
      return NextResponse.json({ error: "Invalid member profile." }, { status: 400 });
    }
    return await memberResponse(slug);
  } catch (error) {
    console.error("Congress member profile failed", error);
    return NextResponse.json(
      { error: "The congressional member profile is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
