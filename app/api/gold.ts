export const GOLD_SPOT_SYMBOL = "XAUUSD";

type GoldApiPayload = {
  currency?: unknown;
  name?: unknown;
  price?: unknown;
  symbol?: unknown;
  updatedAt?: unknown;
};

export type GoldSpot = {
  price: number;
  timestamp: number;
};

let cachedSpot: GoldSpot | null = null;
let cacheExpiresAt = 0;
let pendingSpot: Promise<GoldSpot> | null = null;

export async function fetchGoldSpot(): Promise<GoldSpot> {
  const now = Date.now();
  if (cachedSpot && now < cacheExpiresAt) return cachedSpot;
  if (pendingSpot) return pendingSpot;

  pendingSpot = (async () => {
    const upstream = await fetch("https://api.gold-api.com/price/XAU", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; LedgerMarketDashboard/1.0)",
      },
    });
    if (!upstream.ok) throw new Error(`Gold API status ${upstream.status}`);

    const payload = await upstream.json() as GoldApiPayload;
    if (payload.currency !== "USD" || typeof payload.price !== "number" || !Number.isFinite(payload.price)) {
      throw new Error("Invalid gold spot quote");
    }

    const parsedTime = typeof payload.updatedAt === "string" ? Date.parse(payload.updatedAt) : NaN;
    const spot = {
      price: payload.price,
      timestamp: Number.isFinite(parsedTime) ? Math.floor(parsedTime / 1000) : Math.floor(Date.now() / 1000),
    };
    cachedSpot = spot;
    cacheExpiresAt = Date.now() + 200;
    return spot;
  })();

  try {
    return await pendingSpot;
  } finally {
    pendingSpot = null;
  }
}
