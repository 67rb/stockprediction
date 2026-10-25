const GOLD_SPOT_SYMBOL = "XAUUSD";
const GOLD_HISTORY_PROXY = "GC=F";

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
      events?: {
        dividends?: Record<string, { amount?: number }>;
        splits?: Record<string, { splitRatio?: string }>;
      };
    }>;
  };
};

export type HistoryRow = {
  time: number;
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjustedClose: number;
  volume: number | null;
  dividend: number | null;
  split: string | null;
};

type HistoryOptions = {
  interval: string;
  includePrePost?: boolean;
  range?: string;
  period1?: number;
  period2?: number;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sanitizeHistorySymbol(rawSymbol: string) {
  return rawSymbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

export function historyProxyFor(requestedSymbol: string) {
  return requestedSymbol === GOLD_SPOT_SYMBOL ? GOLD_HISTORY_PROXY : requestedSymbol;
}

export async function fetchYahooHistory(requestedSymbol: string, options: HistoryOptions) {
  const historySymbol = historyProxyFor(requestedSymbol);
  const params = new URLSearchParams({
    interval: options.interval,
    includePrePost: String(Boolean(options.includePrePost)),
    events: "div,splits",
  });
  if (options.range) params.set("range", options.range);
  if (typeof options.period1 === "number") params.set("period1", String(options.period1));
  if (typeof options.period2 === "number") params.set("period2", String(options.period2));

  let payload: YahooChartPayload | null = null;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const upstream = await fetch(
      `https://${host}/v8/finance/chart/${encodeURIComponent(historySymbol)}?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
        },
      },
    );
    if (upstream.ok) {
      payload = await upstream.json() as YahooChartPayload;
      break;
    }
  }
  if (!payload) throw new Error("Historical data provider unavailable");

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!result || !quote) throw new Error("Missing historical chart data");

  const rows = timestamps.flatMap((time, index): HistoryRow[] => {
    const close = finiteNumber(quote.close?.[index]);
    if (close === null || close <= 0) return [];
    const adjustedClose = finiteNumber(adjustedCloses?.[index]) ?? close;
    const eventKey = String(time);
    return [{
      time,
      timestamp: new Date(time * 1000).toISOString(),
      open: finiteNumber(quote.open?.[index]),
      high: finiteNumber(quote.high?.[index]),
      low: finiteNumber(quote.low?.[index]),
      close,
      adjustedClose,
      volume: finiteNumber(quote.volume?.[index]),
      dividend: finiteNumber(result.events?.dividends?.[eventKey]?.amount),
      split: result.events?.splits?.[eventKey]?.splitRatio || null,
    }];
  });
  if (rows.length < 2) throw new Error("Not enough historical rows");

  return {
    requestedSymbol,
    historySymbol,
    proxy: requestedSymbol === GOLD_SPOT_SYMBOL,
    source: "Yahoo Finance",
    currency: String(result.meta?.currency || "USD"),
    exchange: String(result.meta?.exchangeName || result.meta?.fullExchangeName || "Market"),
    instrumentName: String(result.meta?.longName || result.meta?.shortName || historySymbol),
    rows,
  };
}
