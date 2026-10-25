import { NextRequest, NextResponse } from "next/server";
import { sanitizeHistorySymbol } from "../yahoo-history";

export const dynamic = "force-dynamic";

const MAX_HTML_CHARACTERS = 2_000_000;
const MAX_REDIRECTS = 4;
const MIN_PARAGRAPH_LENGTH = 55;
const ARTICLE_HOSTNAME = "finance.yahoo.com";

const SIGNAL_GROUPS = [
  {
    label: "Earnings",
    terms: ["earnings", "revenue", "profit", "sales", "guidance", "quarterly results"],
  },
  {
    label: "Markets",
    terms: ["stock", "shares", "market", "investor", "trading", "index", "futures"],
  },
  {
    label: "Deals",
    terms: ["acquisition", "merger", "takeover", "buyout", "stake", "bid"],
  },
  {
    label: "Policy",
    terms: ["regulator", "regulation", "lawsuit", "antitrust", "tariff", "central bank"],
  },
  {
    label: "Macro",
    terms: ["inflation", "interest rate", "rate cut", "rate hike", "economy", "gdp"],
  },
  {
    label: "Risk",
    terms: ["warning", "risk", "decline", "loss", "default", "bankruptcy", "investigation"],
  },
] as const;

const IMPACT_RULES = [
  { phrase: "beats estimates", label: "Earnings beat", direction: "positive", weight: 5 },
  { phrase: "beat expectations", label: "Expectations beat", direction: "positive", weight: 4 },
  { phrase: "raises guidance", label: "Guidance raised", direction: "positive", weight: 5 },
  { phrase: "raised guidance", label: "Guidance raised", direction: "positive", weight: 5 },
  { phrase: "record revenue", label: "Record revenue", direction: "positive", weight: 3 },
  { phrase: "revenue growth", label: "Revenue growth", direction: "positive", weight: 2 },
  { phrase: "profit growth", label: "Profit growth", direction: "positive", weight: 2 },
  { phrase: "share buyback", label: "Share buyback", direction: "positive", weight: 3 },
  { phrase: "dividend increase", label: "Dividend increased", direction: "positive", weight: 3 },
  { phrase: "regulatory approval", label: "Regulatory approval", direction: "positive", weight: 3 },
  { phrase: "surpasses estimates", label: "Estimates surpassed", direction: "positive", weight: 5 },
  { phrase: "boosts outlook", label: "Outlook improved", direction: "positive", weight: 4 },
  { phrase: "strong demand", label: "Strong demand", direction: "positive", weight: 2 },
  { phrase: "wins contract", label: "Contract win", direction: "positive", weight: 3 },
  { phrase: "contract award", label: "Contract award", direction: "positive", weight: 2 },
  { phrase: "analyst upgrade", label: "Analyst upgrade", direction: "positive", weight: 2 },
  { phrase: "misses estimates", label: "Earnings miss", direction: "negative", weight: 5 },
  { phrase: "missed expectations", label: "Expectations miss", direction: "negative", weight: 4 },
  { phrase: "cuts guidance", label: "Guidance cut", direction: "negative", weight: 5 },
  { phrase: "lowered guidance", label: "Guidance lowered", direction: "negative", weight: 5 },
  { phrase: "profit warning", label: "Profit warning", direction: "negative", weight: 5 },
  { phrase: "weak demand", label: "Weak demand", direction: "negative", weight: 2 },
  { phrase: "supply disruption", label: "Supply disruption", direction: "negative", weight: 3 },
  { phrase: "cash flow warning", label: "Cash-flow warning", direction: "negative", weight: 4 },
  { phrase: "revenue decline", label: "Revenue decline", direction: "negative", weight: 2 },
  { phrase: "profit decline", label: "Profit decline", direction: "negative", weight: 2 },
  { phrase: "analyst downgrade", label: "Analyst downgrade", direction: "negative", weight: 3 },
  { phrase: "regulatory probe", label: "Regulatory probe", direction: "negative", weight: 3 },
  { phrase: "investigation", label: "Investigation", direction: "negative", weight: 2 },
  { phrase: "data breach", label: "Data breach", direction: "negative", weight: 3 },
  { phrase: "product recall", label: "Product recall", direction: "negative", weight: 3 },
  { phrase: "dividend cut", label: "Dividend cut", direction: "negative", weight: 4 },
  { phrase: "default", label: "Default risk", direction: "negative", weight: 5 },
  { phrase: "bankruptcy", label: "Bankruptcy risk", direction: "negative", weight: 6 },
] as const;

const NEAR_TERM_EVENT_TERMS = [
  "earnings",
  "guidance",
  "analyst upgrade",
  "analyst downgrade",
  "share buyback",
  "dividend",
  "merger",
  "acquisition",
  "lawsuit",
  "investigation",
  "recall",
];

const LONGER_TERM_EVENT_TERMS = [
  "interest rate",
  "inflation",
  "tariff",
  "regulation",
  "capital spending",
  "expansion",
  "infrastructure",
];

const BLOCKED_PARAGRAPH_TERMS = [
  "accept cookies",
  "all rights reserved",
  "already a subscriber",
  "click here to subscribe",
  "cookie policy",
  "privacy policy",
  "sign up for",
  "subscribe now",
  "terms of service",
];

type ArticleRequest = {
  articleId?: unknown;
  symbol?: unknown;
};

type JsonRecord = Record<string, unknown>;

type YahooNewsItem = {
  uuid?: string;
  title?: string;
  link?: string;
};

type YahooSearchPayload = {
  news?: YahooNewsItem[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    quot: "\"",
    rdquo: "”",
    rsquo: "’",
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] || entity);
}

function cleanText(value: string) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeArticleUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4_000) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || hostname !== ARTICLE_HOSTNAME
    ) {
      return null;
    }
    return url;
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

async function resolveFeedArticle(symbol: string, articleId: string) {
  const params = new URLSearchParams({
    q: newsQueryFor(symbol),
    quotesCount: "0",
    newsCount: "50",
    enableFuzzyQuery: "false",
  });
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const response = await fetch(`https://${host}/v1/finance/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LedgerArticleInspector/1.0)",
      },
    });
    if (!response.ok) continue;
    const payload = await response.json() as YahooSearchPayload;
    const matched = (payload.news || []).find((item) => (
      item.uuid === articleId
      || (typeof item.title === "string" && titleKey(item.title) === articleId)
    ));
    const url = safeArticleUrl(matched?.link);
    if (matched && url) {
      return {
        url,
        title: typeof matched.title === "string" ? cleanText(matched.title).slice(0, 400) : "",
      };
    }
  }
  return null;
}

function metaContent(html: string, keys: string[]) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return cleanText(content);
  }
  return "";
}

function findArticleJson(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findArticleJson(item);
      if (match) return match;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (
    types.some((item) => (
      typeof item === "string"
      && ["Article", "NewsArticle", "ReportageNewsArticle"].includes(item)
    ))
    || typeof value.articleBody === "string"
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    const match = findArticleJson(child);
    if (match) return match;
  }
  return null;
}

function extractStructuredArticle(html: string) {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts.slice(0, 20)) {
    const raw = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    try {
      const article = findArticleJson(JSON.parse(decodeEntities(raw)));
      if (!article) continue;
      return {
        title: cleanText(typeof article.headline === "string" ? article.headline : ""),
        description: cleanText(typeof article.description === "string" ? article.description : ""),
        body: cleanText(typeof article.articleBody === "string" ? article.articleBody : ""),
      };
    } catch {
      // Some publishers emit malformed JSON-LD. Continue with visible paragraphs.
    }
  }
  return { title: "", description: "", body: "" };
}

function extractParagraphs(html: string) {
  const articleSections = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) || [];
  const source = articleSections.sort((left, right) => right.length - left.length)[0] || html;
  const paragraphs = source.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  const seen = new Set<string>();
  return paragraphs.flatMap((paragraph) => {
    const text = cleanText(paragraph);
    const normalized = text.toLowerCase();
    if (
      text.length < MIN_PARAGRAPH_LENGTH
      || text.length > 2_500
      || BLOCKED_PARAGRAPH_TERMS.some((term) => normalized.includes(term))
      || seen.has(normalized)
    ) {
      return [];
    }
    seen.add(normalized);
    return [text];
  }).slice(0, 60);
}

function countOccurrences(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) || []).length;
}

function countDirectionalOccurrences(text: string, term: string) {
  const searchable = text.toLowerCase();
  const phrase = term.toLowerCase();
  let count = 0;
  let position = searchable.indexOf(phrase);
  while (position >= 0) {
    const prefix = searchable.slice(Math.max(0, position - 45), position);
    const negated = /\b(no|not|never|without|denies?|denied|isn['’]t|wasn['’]t)\b[^.!?]{0,35}$/.test(prefix);
    if (!negated) count += 1;
    position = searchable.indexOf(phrase, position + phrase.length);
  }
  return count;
}

function buildAnalysis(text: string, symbol: string) {
  const searchable = text.slice(0, 120_000);
  const groups = SIGNAL_GROUPS.map((group) => ({
    label: group.label,
    count: group.terms.reduce((total, term) => total + countOccurrences(searchable, term), 0),
  }))
    .filter((group) => group.count > 0)
    .sort((left, right) => right.count - left.count);
  const cleanSymbol = symbol.replace(/[^A-Z0-9]/g, "");
  const tickerMentions = cleanSymbol.length >= 2
    ? countOccurrences(searchable, cleanSymbol)
    : 0;
  const financialMentions = groups.reduce((total, group) => total + group.count, 0);
  const relevanceScore = Math.min(
    100,
    Math.round((tickerMentions > 0 ? 38 : 0) + Math.min(62, financialMentions * 3.1)),
  );
  const impactDrivers = IMPACT_RULES.flatMap((rule) => {
    const count = Math.min(3, countDirectionalOccurrences(searchable, rule.phrase));
    return count
      ? [{
          label: rule.label,
          direction: rule.direction,
          count,
          score: rule.weight * count,
        }]
      : [];
  }).sort((left, right) => right.score - left.score);
  const positiveScore = impactDrivers
    .filter((driver) => driver.direction === "positive")
    .reduce((total, driver) => total + driver.score, 0);
  const negativeScore = impactDrivers
    .filter((driver) => driver.direction === "negative")
    .reduce((total, driver) => total + driver.score, 0);
  const netImpactScore = positiveScore - negativeScore;
  const impactDirection = positiveScore >= 3
    && negativeScore >= 3
    && Math.abs(netImpactScore) <= 3
    ? "mixed"
    : netImpactScore >= 3
      ? "positive"
      : netImpactScore <= -3
        ? "negative"
        : "unclear";
  const distinctDrivers = impactDrivers.length;
  const evidenceStrength = positiveScore + negativeScore;
  const baseConfidence = distinctDrivers >= 3 && evidenceStrength >= 9
    ? "high"
    : distinctDrivers >= 2 || evidenceStrength >= 5
      ? "medium"
      : "low";
  const normalizedText = searchable.toLowerCase();
  const speculativeTerms = ["rumor", "reportedly", "considering", "may ", "might ", "could ", "potential ", "unconfirmed"];
  const confirmedTerms = ["announced", "confirmed", "reported results", "filed", "approved", "completed"];
  const speculativeCount = speculativeTerms.reduce(
    (total, term) => total + countOccurrences(normalizedText, term.trim()),
    0,
  );
  const confirmedCount = confirmedTerms.reduce(
    (total, term) => total + countOccurrences(normalizedText, term),
    0,
  );
  const evidenceQuality = speculativeCount >= Math.max(2, confirmedCount + 1)
    ? "Speculative language"
    : confirmedCount >= 2
      ? "Confirmed / reported event"
      : "Developing report";
  const impactConfidence = evidenceQuality === "Speculative language"
    ? baseConfidence === "high" ? "medium" : "low"
    : baseConfidence;
  const impactHorizon = NEAR_TERM_EVENT_TERMS.some((term) => normalizedText.includes(term))
    ? "Near term · 1–10 trading days"
    : LONGER_TERM_EVENT_TERMS.some((term) => normalizedText.includes(term))
      ? "Developing · weeks to months"
      : "Uncertain · monitor follow-through";
  const impactLabel = impactDirection === "positive"
    ? "Likely bullish pressure"
    : impactDirection === "negative"
      ? "Likely bearish pressure"
      : impactDirection === "mixed"
        ? "Mixed market pressure"
        : "Impact unclear";
  const assetLabel = symbol === "MARKET" ? "the broader market" : symbol;
  const summary = impactDirection === "positive"
    ? `The article contains more positive than negative catalysts. That may support upward price pressure in ${assetLabel}, if the information is not already priced in.`
    : impactDirection === "negative"
      ? `The article contains more negative than positive catalysts. That may create downward price pressure in ${assetLabel}, especially if expectations were higher.`
      : impactDirection === "mixed"
        ? `The article contains meaningful positive and negative catalysts. Price direction may depend on which detail investors treat as most important.`
        : `The extracted text does not contain enough directional evidence for a defensible bullish or bearish call.`;
  return {
    groups: groups.slice(0, 5),
    tickerMentions,
    relevanceScore,
    impact: {
      direction: impactDirection,
      label: impactLabel,
      confidence: impactConfidence,
      horizon: impactHorizon,
      scope: tickerMentions > 0 && symbol !== "MARKET" ? `${symbol} specific` : "Broad / indirect",
      evidenceQuality,
      summary,
      drivers: impactDrivers.slice(0, 5).map(({ label, direction, count }) => ({
        label,
        direction,
        count,
      })),
      disclaimer: "Qualitative scenario estimate from disclosed text rules. It does not predict the size of a price move or account for what the market has already priced in.",
    },
  };
}

function excerptFrom(text: string, length = 900) {
  if (text.length <= length) return text;
  const shortened = text.slice(0, length);
  const sentenceBreak = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("? "),
    shortened.lastIndexOf("! "),
  );
  return `${shortened.slice(0, sentenceBreak > length * 0.55 ? sentenceBreak + 1 : length).trim()}…`;
}

async function fetchArticle(initialUrl: URL) {
  let currentUrl = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; LedgerArticleInspector/1.0; +public-news-reader)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Redirect unavailable");
      const nextUrl = safeArticleUrl(new URL(location, currentUrl).toString());
      if (!nextUrl) throw new Error("Unsafe redirect");
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error(`Publisher returned ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("Not an HTML article");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_HTML_CHARACTERS * 2) throw new Error("Article is too large");
    return {
      html: (await response.text()).slice(0, MAX_HTML_CHARACTERS),
      finalUrl: currentUrl.toString(),
    };
  }
  throw new Error("Too many redirects");
}

export async function POST(request: NextRequest) {
  let payload: ArticleRequest;
  try {
    payload = await request.json() as ArticleRequest;
  } catch {
    return NextResponse.json({ error: "Invalid article request." }, { status: 400 });
  }

  const rawSymbol = typeof payload.symbol === "string" ? payload.symbol : "";
  const symbol = rawSymbol.toUpperCase() === "MARKET"
    ? "MARKET"
    : sanitizeHistorySymbol(rawSymbol);
  const articleId = typeof payload.articleId === "string"
    ? payload.articleId.trim().slice(0, 500)
    : "";
  if (!symbol || !articleId) {
    return NextResponse.json({ error: "That feed article cannot be inspected safely." }, { status: 400 });
  }

  try {
    const feedArticle = await resolveFeedArticle(symbol, articleId);
    if (!feedArticle) {
      return NextResponse.json(
        { error: "That article is no longer present in the dashboard news feed." },
        { status: 404 },
      );
    }
    const url = feedArticle.url;
    const expectedTitle = feedArticle.title;
    const { html, finalUrl } = await fetchArticle(url);
    const structured = extractStructuredArticle(html);
    const paragraphs = extractParagraphs(html);
    const description = structured.description || metaContent(html, [
      "description",
      "og:description",
      "twitter:description",
    ]);
    const visibleBody = structured.body || paragraphs.join("\n\n");
    const analysisText = [expectedTitle, description, visibleBody].filter(Boolean).join("\n\n");
    if (analysisText.length < 120) throw new Error("Readable article text was not exposed");

    const title = structured.title
      || metaContent(html, ["og:title", "twitter:title"])
      || cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      || expectedTitle;
    const wordCount = analysisText.split(/\s+/).filter(Boolean).length;
    const analysis = buildAnalysis(analysisText, symbol);
    const response = NextResponse.json({
      status: visibleBody.length >= 240 ? "readable" : "metadata_only",
      title,
      finalUrl,
      excerpt: excerptFrom(visibleBody || description),
      description: description && !visibleBody.startsWith(description) ? excerptFrom(description, 420) : "",
      wordCount,
      readingMinutes: Math.max(1, Math.ceil(wordCount / 220)),
      relevanceScore: analysis.relevanceScore,
      tickerMentions: analysis.tickerMentions,
      signals: analysis.groups,
      impact: analysis.impact,
      method: structured.body
        ? "Publisher structured article data"
        : paragraphs.length
          ? "Publisher page paragraphs"
          : "Publisher page metadata",
      notice: "Rule-based extraction only. No article text was sent to an AI service.",
    });
    response.headers.set("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    return response;
  } catch {
    return NextResponse.json(
      {
        status: "blocked",
        error: "This story is not available as readable public text on Yahoo Finance. It may open only on the publisher’s site, require a subscription, or block automated readers.",
        finalUrl: "",
        notice: "No paywall or access restriction was bypassed.",
      },
      { status: 422, headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  }
}
