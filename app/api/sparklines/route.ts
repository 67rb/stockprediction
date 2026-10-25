import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type YahooSparkResponse = {
  spark?: {
    result?: Array<{
      symbol?: unknown;
      response?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

function cleanSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

export async function GET(request: NextRequest) {
  const symbols = [...new Set(
    (request.nextUrl.searchParams.get("symbols") || "")
      .split(",")
      .map(cleanSymbol)
      .filter(Boolean),
  )].slice(0, 50);

  if (!symbols.length) {
    return NextResponse.json(
      { error: "At least one ticker is required.", charts: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      range: "1mo",
      interval: "1d",
      indicators: "close",
      includeTimestamps: "true",
      includePrePost: "false",
    });
    const upstream = await fetch(`https://query2.finance.yahoo.com/v7/finance/spark?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
      },
    });
    if (!upstream.ok) throw new Error(`Yahoo spark returned ${upstream.status}`);

    const payload = await upstream.json() as YahooSparkResponse;
    if (payload.spark?.error) {
      throw new Error(payload.spark.error.description || payload.spark.error.code || "Yahoo spark error");
    }

    const charts = (payload.spark?.result || []).flatMap((item) => {
      const symbol = typeof item.symbol === "string" ? cleanSymbol(item.symbol) : "";
      const chart = item.response?.[0];
      const timestamps = chart?.timestamp || [];
      const closes = chart?.indicators?.quote?.[0]?.close || [];
      const points = timestamps.flatMap((time, index) => {
        const value = closes[index];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ time, value }]
          : [];
      });
      return symbol && points.length >= 2 ? [{ symbol, points }] : [];
    });

    const response = NextResponse.json({
      range: "1M",
      interval: "1D",
      source: "Yahoo Finance Spark",
      charts,
    });
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    return response;
  } catch (error) {
    console.error("Sparkline batch failed", error);
    return NextResponse.json(
      { error: "Company charts are temporarily unavailable.", charts: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
