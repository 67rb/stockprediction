import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"];
const MAX_LISTS = 12;
const MAX_SYMBOLS = 9;

type WatchlistRecord = {
  id: string;
  name: string;
  created_at: number;
};

type WatchlistItemRecord = {
  watchlist_id: string;
  symbol: string;
  position: number;
};

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 36) : "";
}

function cleanSymbol(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24)
    : "";
}

function cleanSymbols(value: unknown) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(cleanSymbol).filter(Boolean))].slice(0, MAX_SYMBOLS);
}

async function ensureDefaultWatchlist() {
  const existing = await env.DB
    .prepare("SELECT id FROM watchlists LIMIT 1")
    .first<{ id: string }>();
  if (existing) return;

  const now = Date.now();
  await env.DB.batch([
    env.DB
      .prepare("INSERT OR IGNORE INTO watchlists (id, name, created_at) VALUES (?, ?, ?)")
      .bind("default", "My Watchlist", now),
    ...DEFAULT_SYMBOLS.map((symbol, position) => env.DB
      .prepare(
        "INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol, position, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind("default", symbol, position, now)),
  ]);
}

async function readWatchlists() {
  await ensureDefaultWatchlist();
  const [listResult, itemResult] = await Promise.all([
    env.DB
      .prepare("SELECT id, name, created_at FROM watchlists ORDER BY created_at ASC")
      .all<WatchlistRecord>(),
    env.DB
      .prepare(
        "SELECT watchlist_id, symbol, position FROM watchlist_items ORDER BY watchlist_id, position ASC",
      )
      .all<WatchlistItemRecord>(),
  ]);
  const symbolsByList = new Map<string, string[]>();
  itemResult.results.forEach((item) => {
    const symbols = symbolsByList.get(item.watchlist_id) || [];
    symbols.push(item.symbol);
    symbolsByList.set(item.watchlist_id, symbols);
  });
  return listResult.results.map((list) => ({
    id: list.id,
    name: list.name,
    symbols: symbolsByList.get(list.id) || [],
  }));
}

export async function GET() {
  try {
    const response = NextResponse.json({ watchlists: await readWatchlists() });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Watchlists are currently unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: unknown; symbols?: unknown };
    const name = cleanName(body.name);
    const symbols = cleanSymbols(body.symbols) || [];
    if (!name) {
      return NextResponse.json({ error: "Enter a watchlist name." }, { status: 400 });
    }
    const count = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM watchlists")
      .first<{ total: number }>();
    if ((count?.total || 0) >= MAX_LISTS) {
      return NextResponse.json({ error: `You can save up to ${MAX_LISTS} watchlists.` }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB
        .prepare("INSERT INTO watchlists (id, name, created_at) VALUES (?, ?, ?)")
        .bind(id, name, now),
      ...symbols.map((symbol, position) => env.DB
        .prepare(
          "INSERT INTO watchlist_items (watchlist_id, symbol, position, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(id, symbol, position, now)),
    ]);
    return NextResponse.json({ watchlist: { id, name, symbols } }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "The watchlist could not be created." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { id?: unknown; name?: unknown; symbols?: unknown };
    const id = typeof body.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(body.id) ? body.id : "";
    const name = body.name === undefined ? null : cleanName(body.name);
    const symbols = body.symbols === undefined ? null : cleanSymbols(body.symbols);
    if (!id || (name === null && symbols === null) || name === "" || symbols === null && body.symbols !== undefined) {
      return NextResponse.json({ error: "Invalid watchlist update." }, { status: 400 });
    }

    const exists = await env.DB
      .prepare("SELECT id FROM watchlists WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (!exists) return NextResponse.json({ error: "Watchlist not found." }, { status: 404 });

    const statements: D1PreparedStatement[] = [];
    if (name !== null) {
      statements.push(env.DB.prepare("UPDATE watchlists SET name = ? WHERE id = ?").bind(name, id));
    }
    if (symbols !== null) {
      const now = Date.now();
      statements.push(env.DB.prepare("DELETE FROM watchlist_items WHERE watchlist_id = ?").bind(id));
      symbols.forEach((symbol, position) => {
        statements.push(env.DB
          .prepare(
            "INSERT INTO watchlist_items (watchlist_id, symbol, position, created_at) VALUES (?, ?, ?, ?)",
          )
          .bind(id, symbol, position, now));
      });
    }
    await env.DB.batch(statements);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "The watchlist could not be updated." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
