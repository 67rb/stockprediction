import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type SearchQuote = {
  symbol?: unknown;
  shortname?: unknown;
  longname?: unknown;
  quoteType?: unknown;
  exchange?: unknown;
  exchDisp?: unknown;
  sector?: unknown;
  industry?: unknown;
  score?: unknown;
};

type SearchPayload = {
  quotes?: SearchQuote[];
};

type ChartPayload = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
    }>;
  };
};

type MarketCapPoint = {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: {
    raw?: number;
  };
};

type FundamentalsPayload = {
  timeseries?: {
    result?: Array<{
      trailingMarketCap?: MarketCapPoint[];
    }>;
  };
};

type Candidate = {
  symbol: string;
  searchName: string;
  sector: string;
  industry: string;
  exchange: string;
  score: number;
  themeSeed: boolean;
};

const THEME_GROUPS: Array<{
  keywords: string[];
  queries: string[];
  symbols: string[];
}> = [
  {
    keywords: ["nuclear", "uranium", "atomic power", "small modular reactor", "smr"],
    queries: ["nuclear energy", "uranium", "small modular reactor"],
    symbols: ["CEG", "VST", "GEV", "CCJ", "BWXT", "LEU", "UEC", "NXE", "UUUU", "DNN", "OKLO", "SMR", "NNE", "LTBR", "FLR", "RYCEY"],
  },
  {
    keywords: ["artificial intelligence", " ai ", "machine learning", "generative ai"],
    queries: ["artificial intelligence", "AI software"],
    symbols: ["NVDA", "MSFT", "GOOGL", "AMZN", "META", "ORCL", "PLTR", "AMD", "AVGO", "CRM", "SNOW"],
  },
  {
    keywords: ["semiconductor", "semiconductors", "computer chips", "microchips"],
    queries: ["semiconductor", "computer chip"],
    symbols: ["NVDA", "TSM", "AVGO", "AMD", "INTC", "ASML", "QCOM", "TXN", "ARM", "MU", "AMAT", "LRCX"],
  },
  {
    keywords: ["solar", "solar power", "solar energy"],
    queries: ["solar energy", "solar power"],
    symbols: ["FSLR", "ENPH", "SEDG", "RUN", "NOVA", "CSIQ", "JKS", "DQ", "ARRY", "NXT"],
  },
  {
    keywords: ["wind", "wind power", "wind energy", "wind turbines"],
    queries: ["wind energy", "wind turbine"],
    symbols: ["GEV", "NEE", "CWEN", "TPIC", "VWS.CO", "ORSTED.CO"],
  },
  {
    keywords: ["electric vehicle", "electric vehicles", " ev ", "ev companies"],
    queries: ["electric vehicle", "EV maker"],
    symbols: ["TSLA", "RIVN", "LCID", "NIO", "LI", "XPEV", "BYDDF", "GM", "F"],
  },
  {
    keywords: ["cybersecurity", "cyber security"],
    queries: ["cybersecurity", "network security"],
    symbols: ["CRWD", "PANW", "FTNT", "ZS", "OKTA", "CYBR", "S", "CHKP"],
  },
  {
    keywords: ["space", "spaceflight", "satellite", "rockets"],
    queries: ["space technology", "satellite"],
    symbols: ["RKLB", "LUNR", "ASTS", "PL", "BKSY", "RDW", "SPCE", "BA", "LMT", "NOC"],
  },
  {
    keywords: ["defense", "defence", "military", "weapons"],
    queries: ["defense contractor", "aerospace defense"],
    symbols: ["RTX", "LMT", "NOC", "GD", "BA", "LHX", "HII", "AVAV"],
  },
  {
    keywords: ["quantum", "quantum computing"],
    queries: ["quantum computing", "quantum technology"],
    symbols: ["IONQ", "RGTI", "QBTS", "QUBT", "IBM", "GOOGL", "MSFT"],
  },
  {
    keywords: ["hydrogen", "fuel cell", "fuel cells"],
    queries: ["hydrogen energy", "fuel cell"],
    symbols: ["PLUG", "BE", "BLDP", "FCEL", "APD", "LIN"],
  },
  {
    keywords: ["robotics", "robots", "industrial automation"],
    queries: ["robotics", "industrial automation"],
    symbols: ["ISRG", "SYM", "TER", "ROK", "ABB", "FANUY", "HON"],
  },
  {
    keywords: ["cloud", "cloud computing", "cloud software", "cloud infrastructure"],
    queries: ["cloud computing", "cloud software"],
    symbols: ["AMZN", "MSFT", "GOOGL", "ORCL", "IBM", "CRM", "SNOW", "DDOG", "NET"],
  },
  {
    keywords: ["biotech", "biotechnology", "gene therapy"],
    queries: ["biotechnology", "gene therapy"],
    symbols: ["LLY", "NVO", "REGN", "VRTX", "MRNA", "BIIB", "AMGN", "GILD"],
  },
  {
    keywords: ["bank", "banks", "banking"],
    queries: ["banking", "bank"],
    symbols: ["JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC"],
  },
  {
    keywords: ["software", "saas", "enterprise software"],
    queries: ["software company", "enterprise software"],
    symbols: ["MSFT", "ORCL", "SAP", "CRM", "ADBE", "INTU", "NOW", "PLTR", "SNOW", "CDNS"],
  },
  {
    keywords: ["computer hardware", "computers", "data storage", "servers"],
    queries: ["computer hardware", "data storage"],
    symbols: ["AAPL", "DELL", "HPQ", "HPE", "SMCI", "NTAP", "STX", "WDC", "LOGI"],
  },
  {
    keywords: ["data center", "data centers", "datacenter"],
    queries: ["data center", "data center infrastructure"],
    symbols: ["EQIX", "DLR", "AMT", "CCI", "VRT", "ANET"],
  },
  {
    keywords: ["insurance", "insurers"],
    queries: ["insurance company", "insurer"],
    symbols: ["BRK-B", "PGR", "ALL", "CB", "AIG", "MET", "PRU", "TRV"],
  },
  {
    keywords: ["asset management", "investment management", "private equity"],
    queries: ["asset management", "investment management"],
    symbols: ["BLK", "BX", "KKR", "APO", "TROW", "BEN", "IVZ", "AMP"],
  },
  {
    keywords: ["payments", "payment processing", "credit cards"],
    queries: ["payment processing", "credit card"],
    symbols: ["V", "MA", "AXP", "PYPL", "COF", "FI", "GPN", "AFRM"],
  },
  {
    keywords: ["fintech", "financial technology"],
    queries: ["fintech", "financial technology"],
    symbols: ["PYPL", "XYZ", "COIN", "SOFI", "HOOD", "NU", "AFRM", "UPST"],
  },
  {
    keywords: ["stock exchange", "stock exchanges", "financial exchange", "derivatives exchange"],
    queries: ["stock exchange", "financial exchange"],
    symbols: ["CME", "ICE", "NDAQ", "CBOE", "MKTX"],
  },
  {
    keywords: ["pharma", "pharmaceutical", "pharmaceuticals", "drug makers"],
    queries: ["pharmaceutical company", "drug maker"],
    symbols: ["LLY", "NVO", "JNJ", "ABBV", "MRK", "AZN", "PFE", "NVS", "BMY", "GSK"],
  },
  {
    keywords: ["medical devices", "medical equipment", "healthcare equipment"],
    queries: ["medical device", "medical equipment"],
    symbols: ["ISRG", "ABT", "MDT", "SYK", "BSX", "EW", "ZBH", "BDX", "DXCM"],
  },
  {
    keywords: ["health insurance", "managed healthcare", "health insurers"],
    queries: ["health insurance", "managed healthcare"],
    symbols: ["UNH", "ELV", "CVS", "CI", "HUM", "CNC", "MOH"],
  },
  {
    keywords: ["hospital", "hospitals", "hospital operators"],
    queries: ["hospital operator", "hospital company"],
    symbols: ["HCA", "THC", "UHS", "CYH", "EHC"],
  },
  {
    keywords: ["oil", "oil and gas", "natural gas", "petroleum", "fossil fuels"],
    queries: ["oil and gas", "petroleum company"],
    symbols: ["XOM", "CVX", "COP", "EOG", "OXY", "SLB", "MPC", "PSX", "WMB", "KMI"],
  },
  {
    keywords: ["lithium", "battery", "batteries", "battery technology"],
    queries: ["lithium company", "battery technology"],
    symbols: ["ALB", "SQM", "LAC", "PLL", "QS", "ENVX", "MVST", "FREY"],
  },
  {
    keywords: ["retail", "retailers", "department stores"],
    queries: ["retail company", "retailer"],
    symbols: ["WMT", "COST", "HD", "LOW", "TGT", "TJX", "ROST", "BBY", "DG", "DLTR"],
  },
  {
    keywords: ["ecommerce", "e-commerce", "online shopping", "online retail"],
    queries: ["ecommerce", "online retail"],
    symbols: ["AMZN", "BABA", "SHOP", "MELI", "SE", "EBAY", "ETSY", "PDD", "JD"],
  },
  {
    keywords: ["automotive", "automobiles", "car makers", "cars"],
    queries: ["automotive company", "car maker"],
    symbols: ["TM", "TSLA", "GM", "F", "STLA", "HMC", "RACE", "VWAGY"],
  },
  {
    keywords: ["food", "beverage", "beverages", "food and beverage"],
    queries: ["food and beverage", "beverage company"],
    symbols: ["KO", "PEP", "MDLZ", "KDP", "MNST", "KHC", "HSY", "SYY", "GIS"],
  },
  {
    keywords: ["restaurant", "restaurants", "fast food"],
    queries: ["restaurant company", "fast food"],
    symbols: ["MCD", "SBUX", "YUM", "CMG", "DRI", "QSR", "DPZ", "TXRH"],
  },
  {
    keywords: ["luxury", "luxury goods", "fashion"],
    queries: ["luxury goods", "luxury brand"],
    symbols: ["LVMUY", "HESAY", "RACE", "CPRI", "TPR", "RMS.PA", "MONC.MI"],
  },
  {
    keywords: ["travel", "hotels", "hospitality", "cruise lines"],
    queries: ["travel company", "hotel company"],
    symbols: ["BKNG", "ABNB", "MAR", "HLT", "RCL", "CCL", "EXPE", "TRIP", "MGM"],
  },
  {
    keywords: ["airline", "airlines", "aviation"],
    queries: ["airline company", "commercial aviation"],
    symbols: ["DAL", "UAL", "AAL", "LUV", "ALK", "JBLU", "RYAAY"],
  },
  {
    keywords: ["video games", "gaming", "game publishers", "esports"],
    queries: ["video game company", "game publisher"],
    symbols: ["MSFT", "SONY", "NTDOY", "TTWO", "EA", "RBLX", "UBSFY"],
  },
  {
    keywords: ["aerospace", "aircraft", "airplane manufacturers"],
    queries: ["aerospace company", "aircraft manufacturer"],
    symbols: ["BA", "RTX", "GE", "HON", "TDG", "HEI", "SPR", "TXT", "ERJ"],
  },
  {
    keywords: ["construction", "infrastructure construction", "building materials"],
    queries: ["construction company", "infrastructure construction"],
    symbols: ["CAT", "DE", "VMC", "MLM", "PWR", "EME", "URI", "J", "ACM"],
  },
  {
    keywords: ["industrial machinery", "heavy machinery", "manufacturing equipment"],
    queries: ["industrial machinery", "heavy equipment"],
    symbols: ["CAT", "DE", "ETN", "PH", "EMR", "ROK", "CMI", "PCAR", "ITW"],
  },
  {
    keywords: ["logistics", "delivery", "freight", "trucking"],
    queries: ["logistics company", "freight company"],
    symbols: ["UPS", "FDX", "EXPD", "CHRW", "GXO", "XPO", "JBHT"],
  },
  {
    keywords: ["railroad", "railroads", "rail transport"],
    queries: ["railroad company", "rail transport"],
    symbols: ["UNP", "CSX", "NSC", "CNI", "CP", "TRN"],
  },
  {
    keywords: ["shipping", "marine shipping", "container shipping"],
    queries: ["shipping company", "marine shipping"],
    symbols: ["ZIM", "MATX", "SBLK", "GOGL", "DAC", "GSL", "CMRE"],
  },
  {
    keywords: ["waste management", "recycling", "environmental services"],
    queries: ["waste management", "recycling company"],
    symbols: ["WM", "RSG", "WCN", "CLH", "CWST"],
  },
  {
    keywords: ["telecom", "telecommunications", "mobile networks"],
    queries: ["telecommunications company", "mobile network"],
    symbols: ["TMUS", "VZ", "T", "CMCSA", "CHTR", "ORAN", "AMX", "TEF"],
  },
  {
    keywords: ["streaming", "streaming media", "video streaming", "music streaming"],
    queries: ["streaming media", "streaming company"],
    symbols: ["NFLX", "DIS", "AMZN", "WBD", "PARA", "SPOT", "ROKU"],
  },
  {
    keywords: ["social media", "social network", "social networks"],
    queries: ["social media company", "social network"],
    symbols: ["META", "SNAP", "PINS", "GOOGL", "RDDT", "TCEHY"],
  },
  {
    keywords: ["advertising", "adtech", "marketing agencies"],
    queries: ["advertising company", "adtech"],
    symbols: ["OMC", "IPG", "TTD", "MGNI", "PUBGY", "WPP"],
  },
  {
    keywords: ["gold mining", "gold miners", "precious metals"],
    queries: ["gold mining", "gold miner"],
    symbols: ["NEM", "GOLD", "AEM", "WPM", "FNV", "KGC", "AU", "HMY"],
  },
  {
    keywords: ["copper", "copper mining", "copper miners"],
    queries: ["copper mining", "copper company"],
    symbols: ["FCX", "SCCO", "TECK", "BHP", "RIO", "HBM"],
  },
  {
    keywords: ["steel", "steelmakers", "steel production"],
    queries: ["steel company", "steel producer"],
    symbols: ["NUE", "STLD", "CLF", "X", "MT", "PKX", "CMC"],
  },
  {
    keywords: ["chemicals", "chemical companies", "specialty chemicals"],
    queries: ["chemical company", "specialty chemicals"],
    symbols: ["LIN", "SHW", "ECL", "APD", "DOW", "DD", "LYB", "PPG"],
  },
  {
    keywords: ["reit", "reits", "real estate investment trust", "commercial real estate"],
    queries: ["REIT", "real estate investment trust"],
    symbols: ["PLD", "AMT", "EQIX", "WELL", "SPG", "O", "PSA", "DLR", "CCI", "AVB"],
  },
  {
    keywords: ["data center reit", "data center real estate"],
    queries: ["data center REIT", "data center real estate"],
    symbols: ["EQIX", "DLR", "AMT", "CCI"],
  },
  {
    keywords: ["homebuilder", "homebuilders", "home building", "housing construction"],
    queries: ["homebuilder", "home building"],
    symbols: ["DHI", "LEN", "NVR", "PHM", "TOL", "KBH", "MTH"],
  },
  {
    keywords: ["electric utility", "electric utilities", "power utility", "utility companies"],
    queries: ["electric utility", "power utility"],
    symbols: ["NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "DTE", "EXC", "XEL"],
  },
  {
    keywords: ["water utility", "water utilities", "water companies"],
    queries: ["water utility", "water company"],
    symbols: ["AWK", "WTRG", "SJW", "CWT", "MSEX", "YORW"],
  },
  {
    keywords: ["cannabis", "marijuana", "medical cannabis"],
    queries: ["cannabis company", "marijuana company"],
    symbols: ["TLRY", "CGC", "CRON", "SNDL", "ACB", "OGI"],
  },
  {
    keywords: ["agriculture", "farming", "fertilizer", "farm equipment"],
    queries: ["agriculture company", "farming company"],
    symbols: ["DE", "ADM", "BG", "MOS", "NTR", "CTVA", "FMC", "AGCO", "CF"],
  },
  {
    keywords: ["education", "edtech", "education technology", "online learning"],
    queries: ["education technology", "online learning"],
    symbols: ["DUOL", "COUR", "CHGG", "LRN", "STRA", "UDMY", "ATGE"],
  },
];

const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
};

function cleanQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function cleanSymbol(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 16);
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function matchesTheme(normalizedQuery: string, keyword: string) {
  const normalizedKeyword = keyword.trim();
  if (normalizedKeyword.length <= 3) {
    return new RegExp(`(^|\\s)${normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i")
      .test(normalizedQuery);
  }
  if (normalizedQuery.includes(normalizedKeyword)) return true;

  if (!normalizedKeyword.includes(" ") && normalizedKeyword.length >= 5) {
    const queryWords = normalizedQuery.trim().split(/\s+/).filter(Boolean);
    return queryWords.some((word) => (
      word.length >= 5
      && Math.abs(word.length - normalizedKeyword.length) <= 2
      && editDistance(word, normalizedKeyword) <= 2
    ));
  }
  return false;
}

async function fetchYahoo(path: string) {
  let lastError: unknown;
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(`${host}${path}`, {
        cache: "no-store",
        headers: REQUEST_HEADERS,
      });
      if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
      return await response.json() as unknown;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Yahoo request failed");
}

async function searchYahoo(query: string) {
  const params = new URLSearchParams({
    q: query,
    quotesCount: "30",
    newsCount: "0",
    listsCount: "0",
    enableFuzzyQuery: "true",
  });
  const payload = await fetchYahoo(`/v1/finance/search?${params}`) as SearchPayload;
  return Array.isArray(payload.quotes) ? payload.quotes : [];
}

async function enrichCandidate(candidate: Candidate, period1: number, period2: number) {
  const symbolPath = encodeURIComponent(candidate.symbol);
  const capParams = new URLSearchParams({
    symbol: candidate.symbol,
    type: "trailingMarketCap",
    merge: "false",
    period1: String(period1),
    period2: String(period2),
  });

  const [chartResult, capResult] = await Promise.allSettled([
    fetchYahoo(`/v8/finance/chart/${symbolPath}?range=1d&interval=5m&includePrePost=false`),
    fetchYahoo(`/ws/fundamentals-timeseries/v1/finance/timeseries/${symbolPath}?${capParams}`),
  ]);
  if (chartResult.status !== "fulfilled") return null;

  const chart = chartResult.value as ChartPayload;
  const meta = chart.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") return null;

  const price = meta.regularMarketPrice;
  const previousClose = typeof meta.chartPreviousClose === "number"
    ? meta.chartPreviousClose
    : typeof meta.previousClose === "number"
      ? meta.previousClose
      : price;

  let marketCap: number | null = null;
  let marketCapAsOf: string | null = null;
  let marketCapCurrency: string | null = null;
  if (capResult.status === "fulfilled") {
    const fundamentals = capResult.value as FundamentalsPayload;
    const points = fundamentals.timeseries?.result
      ?.flatMap((series) => Array.isArray(series.trailingMarketCap) ? series.trailingMarketCap : [])
      .filter((point) => typeof point.reportedValue?.raw === "number") || [];
    const latest = points.sort((a, b) => String(a.asOfDate || "").localeCompare(String(b.asOfDate || ""))).at(-1);
    if (latest && typeof latest.reportedValue?.raw === "number") {
      marketCap = latest.reportedValue.raw;
      marketCapAsOf = latest.asOfDate || null;
      marketCapCurrency = latest.currencyCode || null;
    }
  }

  const change = price - previousClose;
  return {
    symbol: String(meta.symbol || candidate.symbol),
    name: String(meta.longName || meta.shortName || candidate.searchName || candidate.symbol),
    price,
    previousClose,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    currency: String(meta.currency || "USD"),
    exchange: String(meta.fullExchangeName || meta.exchangeName || candidate.exchange || "Market"),
    marketState: String(meta.marketState || "UNKNOWN"),
    marketCap,
    marketCapAsOf,
    marketCapCurrency: marketCapCurrency || String(meta.currency || "USD"),
    sector: candidate.sector,
    industry: candidate.industry,
    themeSeed: candidate.themeSeed,
    relevanceScore: candidate.score,
  };
}

export async function GET(request: NextRequest) {
  const query = cleanQuery(request.nextUrl.searchParams.get("q") || "");
  if (query.length < 2) {
    return NextResponse.json(
      { error: "Enter at least two characters.", companies: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const normalizedQuery = ` ${query.toLowerCase()} `;
  const matchedGroups = THEME_GROUPS.filter((group) => (
    group.keywords.some((keyword) => matchesTheme(normalizedQuery, keyword))
  ));
  const expandedQueries = [...new Set([
    query,
    ...matchedGroups.flatMap((group) => group.queries),
  ])].slice(0, 4);

  const searchResults = await Promise.allSettled(expandedQueries.map(searchYahoo));
  const candidateMap = new Map<string, Candidate>();

  searchResults.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((quote) => {
      if (quote.quoteType !== "EQUITY") return;
      const symbol = cleanSymbol(quote.symbol);
      if (!symbol) return;
      const nextScore = typeof quote.score === "number" ? quote.score : 0;
      const existing = candidateMap.get(symbol);
      candidateMap.set(symbol, {
        symbol,
        searchName: String(quote.longname || quote.shortname || existing?.searchName || symbol),
        sector: String(quote.sector || existing?.sector || "Theme match"),
        industry: String(quote.industry || existing?.industry || "Yahoo company search"),
        exchange: String(quote.exchDisp || quote.exchange || existing?.exchange || ""),
        score: Math.max(existing?.score || 0, nextScore),
        themeSeed: existing?.themeSeed || false,
      });
    });
  });

  matchedGroups.flatMap((group) => group.symbols).forEach((rawSymbol) => {
    const symbol = cleanSymbol(rawSymbol);
    if (!symbol) return;
    const existing = candidateMap.get(symbol);
    candidateMap.set(symbol, {
      symbol,
      searchName: existing?.searchName || symbol,
      sector: existing?.sector || "Theme match",
      industry: existing?.industry || `Matched to “${query}”`,
      exchange: existing?.exchange || "",
      score: Math.max(existing?.score || 0, 100),
      themeSeed: true,
    });
  });

  const candidates = [...candidateMap.values()]
    .sort((a, b) => Number(b.themeSeed) - Number(a.themeSeed) || b.score - a.score)
    .slice(0, 24);

  if (!candidates.length) {
    return NextResponse.json({
      query,
      expandedQueries,
      fetchedAt: new Date().toISOString(),
      count: 0,
      marketCapCoverage: 0,
      companies: [],
    });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const period1 = nowSeconds - (10 * 365 * 24 * 60 * 60);
  const period2 = nowSeconds + (2 * 24 * 60 * 60);
  const results = await Promise.allSettled(
    candidates.map((candidate) => enrichCandidate(candidate, period1, period2)),
  );
  const companies = results
    .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
    .sort((a, b) => {
      if (a.marketCap !== null && b.marketCap !== null) return b.marketCap - a.marketCap;
      if (a.marketCap !== null) return -1;
      if (b.marketCap !== null) return 1;
      return b.relevanceScore - a.relevanceScore;
    })
    .map((company, index) => ({ ...company, rank: index + 1 }));

  const response = NextResponse.json({
    query,
    expandedQueries,
    fetchedAt: new Date().toISOString(),
    count: companies.length,
    marketCapCoverage: companies.filter((company) => company.marketCap !== null).length,
    companies,
  });
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}
