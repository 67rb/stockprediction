import { NextRequest, NextResponse } from "next/server";
import { fetchYahooHistory, sanitizeHistorySymbol } from "../yahoo-history";
import type { HistoryRow } from "../yahoo-history";

export const dynamic = "force-dynamic";

type Granularity = "1m" | "5m" | "1h" | "1d";

const archiveOptions: Record<Granularity, {
  interval: string;
  coverage: string;
  range?: string;
  fullHistory?: boolean;
}> = {
  "1m": { interval: "1m", range: "7d", coverage: "Last 7 days" },
  "5m": { interval: "5m", range: "60d", coverage: "Last 60 days" },
  "1h": { interval: "1h", range: "2y", coverage: "Last 2 years" },
  "1d": { interval: "1d", coverage: "Full available history", fullHistory: true },
};

function csvValue(value: string | number | null) {
  if (value === null) return "";
  const text = String(value);
  return text.includes(",") || text.includes("\"") || text.includes("\n")
    ? `"${text.replaceAll("\"", "\"\"")}"`
    : text;
}

function rowsToCsv(rows: HistoryRow[]) {
  const header = [
    "timestamp_utc",
    "open",
    "high",
    "low",
    "close",
    "adjusted_close",
    "volume",
    "dividend",
    "split",
  ].join(",");
  const lines = rows.map((row) => [
    row.timestamp,
    row.open,
    row.high,
    row.low,
    row.close,
    row.adjustedClose,
    row.volume,
    row.dividend,
    row.split,
  ].map(csvValue).join(","));
  return [header, ...lines].join("\n");
}

export async function GET(request: NextRequest) {
  const requestedSymbol = sanitizeHistorySymbol(request.nextUrl.searchParams.get("symbol") || "AAPL");
  const requestedGranularity = request.nextUrl.searchParams.get("granularity") as Granularity | null;
  const granularity: Granularity = requestedGranularity && requestedGranularity in archiveOptions
    ? requestedGranularity
    : "1m";
  const format = request.nextUrl.searchParams.get("format") || "json";
  const option = archiveOptions[granularity];

  try {
    if (!requestedSymbol) throw new Error("Missing symbol");
    const now = Math.floor(Date.now() / 1000) + 86_400;
    const history = await fetchYahooHistory(requestedSymbol, {
      interval: option.interval,
      includePrePost: true,
      range: option.range,
      period1: option.fullHistory ? 0 : undefined,
      period2: option.fullHistory ? now : undefined,
    });
    const result = {
      ...history,
      granularity,
      coverage: option.coverage,
      rowCount: history.rows.length,
      startTime: history.rows[0].time,
      endTime: history.rows[history.rows.length - 1].time,
      fields: ["timestamp", "open", "high", "low", "close", "adjustedClose", "volume", "dividend", "split"],
    };
    const filename = `${requestedSymbol.replaceAll("^", "")}_${granularity}_history`;

    if (format === "csv") {
      return new NextResponse(rowsToCsv(history.rows), {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    if (request.nextUrl.searchParams.get("download") === "1") {
      response.headers.set("Content-Disposition", `attachment; filename="${filename}.json"`);
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: "Historical candle data is currently unavailable for that symbol." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
