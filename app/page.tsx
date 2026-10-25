"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import tradingCostProfiles from "@/data/trading-cost-profiles.json";
import { MARKET_DIRECTORY_CATALOG } from "@/lib/market-directory";
import ForwardMonteCarloPanel from "./MonteCarloPanel";

type RangeKey = "1D" | "1W" | "1M" | "3M" | "1Y";

type Quote = {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  exchange: string;
  marketState: string;
  live: boolean;
  sourceTimestamp?: number;
};

type MarketDetail = Quote & {
  range: RangeKey;
  high: number;
  low: number;
  open: number;
  volume: number;
  points: Array<{ time: number; value: number }>;
  fetchedAt?: number;
  trailingPE?: number;
  forwardPE?: number;
  trailingEPS?: number;
};

type SavedWatchlist = {
  id: string;
  name: string;
  symbols: string[];
};

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"];
const DEFAULT_WATCHLISTS: SavedWatchlist[] = [
  { id: "default", name: "My Watchlist", symbols: DEFAULT_WATCHLIST },
];
const RANGE_OPTIONS: RangeKey[] = ["1D", "1W", "1M", "3M", "1Y"];
const INDEX_SYMBOLS = ["^GSPC", "^DJI", "^IXIC"];
const MARKET_PULSE_LIMIT = 12;
const MARKET_PULSE_STORAGE_KEY = "ledger-market-pulse-symbols";
const GOLD_SPOT_SYMBOL = "XAUUSD";

type TickerOption = {
  symbol: string;
  name: string;
};

const TICKER_CATALOG: TickerOption[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "BAC", name: "Bank of America" },
  { symbol: "V", name: "Visa" },
  { symbol: "MA", name: "Mastercard" },
  { symbol: "WMT", name: "Walmart" },
  { symbol: "COST", name: "Costco" },
  { symbol: "KO", name: "Coca-Cola" },
  { symbol: "DIS", name: "Walt Disney" },
  { symbol: "NKE", name: "Nike" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" },
  { symbol: "QQQ", name: "Invesco QQQ ETF" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF" },
  { symbol: "XAUUSD", name: "Gold spot · USD" },
  { symbol: "GC=F", name: "Gold futures" },
  { symbol: "BTC-USD", name: "Bitcoin · USD" },
  { symbol: "ETH-USD", name: "Ethereum · USD" },
  { symbol: "EURUSD=X", name: "Euro · US dollar" },
  { symbol: "^GSPC", name: "S&P 500 index" },
  { symbol: "^DJI", name: "Dow Jones index" },
  { symbol: "^IXIC", name: "Nasdaq Composite" },
];

const indexNames: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^IXIC": "Nasdaq",
};

function cleanTicker(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
}

function SearchableTickerSelect({
  value,
  options,
  onChange,
  tone = "light",
  ariaLabel,
  triggerLabel,
  triggerDescription,
}: {
  value: string;
  options: TickerOption[];
  onChange: (symbol: string) => void;
  tone?: "light" | "dark";
  ariaLabel: string;
  triggerLabel?: string;
  triggerDescription?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<TickerOption[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const selected = options.find((option) => option.symbol === value);
  const normalizedSearch = search.trim().toUpperCase();
  const directTicker = /^[A-Za-z0-9.^=-]+$/.test(search.trim()) ? cleanTicker(search) : "";
  const localOptions = options
    .filter((option) => (
      !normalizedSearch
      || option.symbol.includes(normalizedSearch)
      || option.name.toUpperCase().includes(normalizedSearch)
    ))
    .slice(0, 12);
  const filteredOptions = [...localOptions, ...remoteOptions]
    .filter((option, index, items) => (
      items.findIndex((candidate) => candidate.symbol === option.symbol) === index
    ))
    .slice(0, 20);
  const hasDirectMatch = filteredOptions.some((option) => option.symbol === directTicker);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  useEffect(() => {
    const query = search.trim();
    if (!open || query.length < 2) {
      setRemoteOptions([]);
      setRemoteLoading(false);
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      setRemoteLoading(true);
      fetch(`/api/ticker-search?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Ticker search failed");
          return response.json() as Promise<{ results?: TickerOption[] }>;
        })
        .then((payload) => {
          setRemoteOptions(Array.isArray(payload.results) ? payload.results : []);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setRemoteOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setRemoteLoading(false);
        });
    }, 220);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [open, search]);

  function choose(nextSymbol: string) {
    onChange(nextSymbol);
    setSearch("");
    setOpen(false);
  }

  function chooseFromSearch() {
    const exact = filteredOptions.find((option) => option.symbol === directTicker);
    const nextSymbol = exact?.symbol || filteredOptions[0]?.symbol || directTicker;
    if (nextSymbol) choose(nextSymbol);
  }

  return (
    <div className={`ticker-picker ${tone}`} ref={rootRef}>
      <button
        type="button"
        className="ticker-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setSearch("");
        }}
      >
        <span>
          <strong>{value || triggerLabel || "Choose ticker"}</strong>
          <small>{selected?.name || (value ? "Custom ticker" : triggerDescription || "Search global listings")}</small>
        </span>
        <i aria-hidden="true">⌄</i>
      </button>

      {open && (
        <div className="ticker-picker-menu">
          <div className="ticker-picker-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  chooseFromSearch();
                }
              }}
              placeholder="Search symbol or company"
              aria-label="Search ticker list"
            />
          </div>
          <div className="ticker-picker-options" role="listbox" aria-label="Ticker results">
            {filteredOptions.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.symbol === value}
                className={option.symbol === value ? "current" : ""}
                key={option.symbol}
                onClick={() => choose(option.symbol)}
              >
                <span>
                  <strong>{option.symbol}</strong>
                  <small>{option.name}</small>
                </span>
                {option.symbol === value && <i>SELECTED</i>}
              </button>
            ))}
            {remoteLoading && (
              <p className="ticker-search-loading">Searching global stock listings…</p>
            )}
            {directTicker && !hasDirectMatch && (
              <button
                type="button"
                className="use-ticker"
                onClick={() => choose(directTicker)}
              >
                <span>
                  <strong>Use {directTicker}</strong>
                  <small>Load this exact Yahoo ticker</small>
                </span>
                <i>ENTER</i>
              </button>
            )}
            {!filteredOptions.length && !directTicker && !remoteLoading && (
              <p>Type a company name or ticker to continue.</p>
            )}
          </div>
          <small className="ticker-picker-hint">Live search covers every equity listing available through Yahoo Finance.</small>
        </div>
      )}
    </div>
  );
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAxisPrice(value: number, currency = "USD") {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1_000 ? 0 : magnitude >= 10 ? 2 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPointTime(timestamp: number, range: RangeKey) {
  const date = new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1));
  if (range === "1D") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "1Y") {
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatHoverTime(timestamp: number, range: RangeKey) {
  const date = new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1));
  if (range === "1D" || range === "1W") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MarketChart({
  points,
  positive,
  range,
  currency,
}: {
  points: MarketDetail["points"];
  positive: boolean;
  range: RangeKey;
  currency: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const chartColor = positive ? "#adff2f" : "#ff695e";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      const height = rect.height;
      const padding = { top: 18, right: 76, bottom: 30, left: 6 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const plotRight = padding.left + chartWidth;
      const values = points.map((point) => point.value);
      const rawMin = Math.min(...values);
      const rawMax = Math.max(...values);
      const spread = Math.max(rawMax - rawMin, rawMax * 0.008);
      const min = rawMin - spread * 0.16;
      const max = rawMax + spread * 0.16;
      const x = (index: number) => padding.left + (index / (points.length - 1)) * chartWidth;
      const y = (value: number) => padding.top + ((max - value) / (max - min)) * chartHeight;

      context.clearRect(0, 0, width, height);
      context.strokeStyle = "rgba(30, 32, 29, 0.10)";
      context.lineWidth = 1;
      for (let line = 0; line < 4; line += 1) {
        const lineY = padding.top + (line / 3) * chartHeight;
        context.beginPath();
        context.moveTo(padding.left, lineY + 0.5);
        context.lineTo(plotRight, lineY + 0.5);
        context.stroke();

        const axisValue = max - (line / 3) * (max - min);
        context.fillStyle = "rgba(30, 32, 29, 0.58)";
        context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textAlign = "left";
        context.textBaseline = line === 0 ? "top" : line === 3 ? "bottom" : "middle";
        context.fillText(formatAxisPrice(axisValue, currency), plotRight + 8, lineY);
      }

      const gradient = context.createLinearGradient(0, padding.top, 0, height);
      gradient.addColorStop(0, positive ? "rgba(173, 255, 47, 0.22)" : "rgba(255, 105, 94, 0.20)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.lineTo(x(points.length - 1), padding.top + chartHeight);
      context.lineTo(x(0), padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.strokeStyle = chartColor;
      context.lineWidth = 2.2;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();

      const lastIndex = points.length - 1;
      context.beginPath();
      context.arc(x(lastIndex), y(points[lastIndex].value), 4, 0, Math.PI * 2);
      context.fillStyle = chartColor;
      context.fill();
      context.strokeStyle = "#151713";
      context.lineWidth = 2;
      context.stroke();

      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = "rgba(30, 32, 29, 0.54)";
      context.textBaseline = "bottom";
      const labelIndexes = [0, Math.floor(lastIndex / 2), lastIndex];
      labelIndexes.forEach((pointIndex, labelIndex) => {
        const label = formatPointTime(points[pointIndex].time, range);
        context.textAlign = labelIndex === 0 ? "left" : labelIndex === 2 ? "right" : "center";
        context.fillText(label, x(pointIndex), height);
      });

      const hoverIndex = hoverIndexRef.current === null
        ? null
        : Math.min(points.length - 1, hoverIndexRef.current);
      if (hoverIndex === null) return;

      const hoveredPoint = points[hoverIndex];
      const hoverX = x(hoverIndex);
      const hoverY = y(hoveredPoint.value);
      context.save();
      context.setLineDash([4, 4]);
      context.strokeStyle = "rgba(29, 32, 27, 0.46)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(hoverX, padding.top);
      context.lineTo(hoverX, padding.top + chartHeight);
      context.stroke();
      context.setLineDash([]);

      context.beginPath();
      context.arc(hoverX, hoverY, 5, 0, Math.PI * 2);
      context.fillStyle = chartColor;
      context.fill();
      context.strokeStyle = "#151713";
      context.lineWidth = 2;
      context.stroke();

      const priceLabel = formatMoney(hoveredPoint.value, currency);
      const timeLabel = formatHoverTime(hoveredPoint.time, range);
      context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      const priceWidth = context.measureText(priceLabel).width;
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      const timeWidth = context.measureText(timeLabel).width;
      const tooltipWidth = Math.max(132, priceWidth + 22, timeWidth + 22);
      const tooltipHeight = 48;
      const tooltipX = hoverX + tooltipWidth + 14 > plotRight
        ? Math.max(4, hoverX - tooltipWidth - 12)
        : hoverX + 12;
      const tooltipY = Math.min(
        padding.top + chartHeight - tooltipHeight,
        Math.max(padding.top, hoverY - tooltipHeight / 2),
      );

      context.fillStyle = "#1d201b";
      context.strokeStyle = chartColor;
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 5);
      context.fill();
      context.stroke();

      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = "#ffffff";
      context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(priceLabel, tooltipX + 11, tooltipY + 20);
      context.fillStyle = "rgba(255, 255, 255, 0.62)";
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(timeLabel, tooltipX + 11, tooltipY + 37);
      context.restore();
    };

    const updateHover = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const paddingLeft = 6;
      const chartWidth = rect.width - paddingLeft - 76;
      const pointerX = Math.min(chartWidth, Math.max(0, event.clientX - rect.left - paddingLeft));
      hoverIndexRef.current = Math.round((pointerX / chartWidth) * (points.length - 1));
      draw();
    };
    const clearHover = () => {
      hoverIndexRef.current = null;
      draw();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    canvas.addEventListener("pointermove", updateHover);
    canvas.addEventListener("pointerdown", updateHover);
    canvas.addEventListener("pointerleave", clearHover);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointermove", updateHover);
      canvas.removeEventListener("pointerdown", updateHover);
      canvas.removeEventListener("pointerleave", clearHover);
    };
  }, [chartColor, currency, points, positive, range]);

  return (
    <canvas
      ref={canvasRef}
      className="market-chart"
      aria-label={`${range} price chart. Hover to inspect the nearest price and time.`}
    />
  );
}

function Change({ value, percent = false }: { value: number; percent?: boolean }) {
  const positive = value >= 0;
  return (
    <span className={positive ? "change up" : "change down"}>
      {positive ? "↗" : "↘"} {positive ? "+" : ""}
      {value.toFixed(2)}
      {percent ? "%" : ""}
    </span>
  );
}

type MonteCarloResult = {
  p25: number[];
  median: number[];
  p75: number[];
  outerLow: number[];
  outerHigh: number[];
  samplePaths: number[][];
  terminalBins: Array<{
    low: number;
    high: number;
    count: number;
  }>;
  simulations: number;
  bootstrapMethod: string;
  expectedBlockLength: number;
  confidenceLevel: number;
  observationsUsed: number;
  medianTerminal: number;
  lowTerminal: number;
  highTerminal: number;
  probabilityAboveTarget: number;
  probabilityMargin: number;
  probabilityOfGain: number;
  probabilityOfTenPercentLoss: number;
  medianMaxDrawdown: number;
  probabilityOfHalfLoss: number;
  medianTimeUnderwater: number;
  expectedShortfallReturn: number;
};

type HistoryCalibration = {
  requestedSymbol: string;
  historySymbol: string;
  proxy: boolean;
  dataPack: boolean;
  source: string;
  lookback: string;
  observations: number;
  logReturns: number[];
  volatilityRegimes: number[];
  currentVolatilityRegime: number;
  periodsPerYear: number;
  calendarMode: "trading" | "calendar";
  annualizedReturn: number;
  annualizedVolatility: number;
  latestAnnualizedVolatility: number;
  startTime: number;
  endTime: number;
};

const MONTE_HORIZONS = [
  { label: "1W", days: 5 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 1_260 },
] as const;

const MONTE_CALIBRATION_WINDOWS = [
  { label: "1Y", days: 252 },
  { label: "3Y", days: 756 },
  { label: "5Y", days: 1_260 },
  { label: "MAX", days: 10_000 },
] as const;

const MONTE_REGIMES = [
  { value: "full", label: "Full history" },
  { value: "balanced", label: "Adaptive" },
  { value: "recent", label: "Recent regime" },
] as const;

const MONTE_SCENARIOS = [
  { value: "historical", label: "Historical", drift: 0, volatility: 1 },
  { value: "defensive", label: "Defensive", drift: -4, volatility: 1.2 },
  { value: "bull", label: "Bull case", drift: 4, volatility: 0.95 },
  { value: "shock", label: "Vol shock", drift: 0, volatility: 1.5 },
] as const;

const MONTE_CONFIDENCE_LEVELS = [80, 90, 95] as const;

type MonteCalibrationWindow = (typeof MONTE_CALIBRATION_WINDOWS)[number]["days"];
type MonteRegime = (typeof MONTE_REGIMES)[number]["value"];
type MonteScenario = (typeof MONTE_SCENARIOS)[number]["value"] | "custom";
type MonteConfidence = (typeof MONTE_CONFIDENCE_LEVELS)[number];

function clampMonteHorizon(value: number) {
  return Math.min(1_260, Math.max(5, Math.round(value)));
}

function monteSimulationCount(horizon: number) {
  if (horizon <= 63) return 6_000;
  if (horizon <= 252) return 5_000;
  if (horizon <= 504) return 3_000;
  return 2_000;
}

function formatMonteHorizon(days: number, calendarMode: "trading" | "calendar") {
  const preset = MONTE_HORIZONS.find((option) => option.days === days);
  const dayLabel = calendarMode === "calendar" ? "calendar days" : "trading days";
  if (preset) return `${preset.label} · ${days.toLocaleString()} ${dayLabel}`;
  return `${days.toLocaleString()} ${dayLabel}`;
}

function addMonteDays(date: Date, days: number, calendarMode: "trading" | "calendar") {
  const result = new Date(date);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (calendarMode === "calendar" || (weekday !== 0 && weekday !== 6)) remaining -= 1;
  }
  return result;
}

function formatMonteDate(date: Date, horizon: number) {
  return new Intl.DateTimeFormat("en-ZA", horizon > 252
    ? { month: "short", year: "numeric" }
    : { day: "2-digit", month: "short", year: horizon > 63 ? "2-digit" : undefined }).format(date);
}

function MonteCarloPanel({
  detail,
  loading,
  symbol,
  tickerOptions,
  onSelectTicker,
}: {
  detail: MarketDetail | null;
  loading: boolean;
  symbol: string;
  tickerOptions: TickerOption[];
  onSelectTicker: (symbol: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const [horizon, setHorizon] = useState(63);
  const [horizonDraft, setHorizonDraft] = useState("63");
  const [targetPrice, setTargetPrice] = useState(0);
  const [startingPrice, setStartingPrice] = useState(0);
  const [seed, setSeed] = useState(1);
  const [calibrationWindow, setCalibrationWindow] = useState<MonteCalibrationWindow>(1_260);
  const [regime, setRegime] = useState<MonteRegime>("balanced");
  const [confidence, setConfidence] = useState<MonteConfidence>(90);
  const [scenario, setScenario] = useState<MonteScenario>("historical");
  const [driftAdjustment, setDriftAdjustment] = useState(0);
  const [volatilityMultiplier, setVolatilityMultiplier] = useState(1);
  const [simulationState, setSimulationState] = useState<{
    key: string;
    result: MonteCarloResult | null;
    progress: number;
    error: boolean;
  }>({ key: "", result: null, progress: 0, error: false });
  const [historyState, setHistoryState] = useState<{
    symbol: string;
    calibration: HistoryCalibration | null;
    error: boolean;
  }>({ symbol: "", calibration: null, error: false });
  const calibration = historyState.symbol === symbol ? historyState.calibration : null;
  const historyLoading = historyState.symbol !== symbol;
  const historyError = historyState.symbol === symbol && historyState.error;
  const detailReady = !loading && detail?.symbol === symbol && detail.price > 0;
  const simulationReady = Boolean(
    detailReady
    && calibration?.requestedSymbol === symbol
    && !historyLoading
    && !historyError
    && startingPrice > 0
    && targetPrice > 0,
  );

  useEffect(() => {
    if (!detail || detail.symbol !== symbol) return;
    setStartingPrice(detail.price);
    setTargetPrice(Number((detail.price * 1.1).toFixed(2)));
    setSeed(Date.now());
  }, [detail?.symbol, symbol]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("History request failed");
        return response.json() as Promise<HistoryCalibration>;
      })
      .then((payload) => {
        if (
          payload.requestedSymbol !== symbol
          || !Array.isArray(payload.logReturns)
          || payload.logReturns.length < 120
          || !Array.isArray(payload.volatilityRegimes)
          || payload.volatilityRegimes.length !== payload.logReturns.length
          || !Number.isFinite(payload.periodsPerYear)
        ) {
          throw new Error("Invalid history response");
        }
        setHistoryState({ symbol, calibration: payload, error: false });
        setSeed(Date.now());
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoryState({ symbol, calibration: null, error: true });
      });

    return () => controller.abort();
  }, [symbol]);

  const simulationKey = [
    symbol,
    startingPrice,
    targetPrice,
    horizon,
    calibrationWindow,
    regime,
    confidence,
    driftAdjustment,
    volatilityMultiplier,
    seed,
  ].join(":");
  const result = simulationState.key === simulationKey ? simulationState.result : null;
  const simulationProgress = simulationState.key === simulationKey ? simulationState.progress : 0;
  const simulationError = simulationState.key === simulationKey && simulationState.error;
  const calendarMode = calibration?.calendarMode || "trading";
  const forecastDate = useMemo(
    () => addMonteDays(new Date(), horizon, calendarMode),
    [calendarMode, horizon],
  );
  const forecastDayLabel = calendarMode === "calendar" ? "calendar days" : "trading days";
  const calibrationObservations = calibration
    ? Math.min(calibrationWindow, calibration.logReturns.length)
    : 0;

  useEffect(() => {
    if (!simulationReady || !calibration) {
      setSimulationState({ key: "", result: null, progress: 0, error: false });
      return;
    }

    const requestId = simulationKey;
    const worker = new Worker("/monte-carlo-worker.js");
    setSimulationState({ key: requestId, result: null, progress: 0.02, error: false });
    worker.onmessage = (event: MessageEvent<{
      type: "progress" | "result" | "error";
      requestId: string;
      progress?: number;
      result?: MonteCarloResult;
    }>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === "progress") {
        setSimulationState((current) => current.key === requestId
          ? { ...current, progress: event.data.progress || current.progress }
          : current);
        return;
      }
      if (event.data.type === "result" && event.data.result) {
        setSimulationState({ key: requestId, result: event.data.result, progress: 1, error: false });
        worker.terminate();
        return;
      }
      setSimulationState({ key: requestId, result: null, progress: 0, error: true });
      worker.terminate();
    };
    worker.onerror = () => {
      setSimulationState({ key: requestId, result: null, progress: 0, error: true });
      worker.terminate();
    };
    worker.postMessage({
      requestId,
      startingPrice,
      targetPrice,
      horizon,
      historicalReturns: calibration.logReturns.slice(-calibrationWindow),
      returnRegimes: calibration.volatilityRegimes.slice(-calibrationWindow),
      currentVolatilityRegime: calibration.currentVolatilityRegime,
      periodsPerYear: calibration.periodsPerYear,
      seed,
      regime,
      confidence,
      annualDriftAdjustment: driftAdjustment / 100,
      volatilityMultiplier,
    });

    return () => worker.terminate();
  }, [
    calibration,
    calibrationWindow,
    confidence,
    driftAdjustment,
    horizon,
    regime,
    seed,
    simulationKey,
    simulationReady,
    startingPrice,
    symbol,
    targetPrice,
    volatilityMultiplier,
  ]);

  function chooseHorizon(days: number) {
    const nextHorizon = clampMonteHorizon(days);
    setHorizon(nextHorizon);
    setHorizonDraft(String(nextHorizon));
    setSeed(Date.now());
  }

  function applyCustomHorizon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    chooseHorizon(Number(horizonDraft) || 5);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;

    let currentProgress = 0;
    let currentMedianOpacity = 0;
    let animationFrame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (progress: number, medianOpacity: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const width = rect.width;
      const height = rect.height;
      const padding = { top: 16, right: 78, bottom: 32, left: 12 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const plotRight = padding.left + chartWidth;
      const low = Math.min(...result.outerLow);
      const high = Math.max(...result.outerHigh);
      const spread = Math.max(high - low, startingPrice * 0.02);
      const min = low - spread * 0.08;
      const max = high + spread * 0.08;
      const x = (index: number) => padding.left + (index / (result.median.length - 1)) * chartWidth;
      const y = (value: number) => padding.top + ((max - value) / (max - min)) * chartHeight;
      const visibleSteps = Math.max(1, Math.floor((result.median.length - 1) * progress));

      context.clearRect(0, 0, width, height);
      context.strokeStyle = "rgba(255, 255, 255, 0.11)";
      context.lineWidth = 1;
      for (let line = 0; line < 4; line += 1) {
        const lineY = padding.top + (line / 3) * chartHeight;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(plotRight, lineY);
        context.stroke();

        const axisValue = max - (line / 3) * (max - min);
        context.fillStyle = "rgba(255, 255, 255, 0.58)";
        context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textAlign = "left";
        context.textBaseline = line === 0 ? "top" : line === 3 ? "bottom" : "middle";
        context.fillText(formatAxisPrice(axisValue, detail?.currency || "USD"), plotRight + 8, lineY);
      }

      const drawBand = (
        upper: number[],
        lower: number[],
        topColor: string,
        bottomColor: string,
      ) => {
        context.beginPath();
        for (let index = 0; index <= visibleSteps; index += 1) {
          const value = upper[index];
          if (index === 0) context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        }
        for (let index = visibleSteps; index >= 0; index -= 1) {
          context.lineTo(x(index), y(lower[index]));
        }
        context.closePath();
        const band = context.createLinearGradient(0, padding.top, 0, height);
        band.addColorStop(0, topColor);
        band.addColorStop(1, bottomColor);
        context.fillStyle = band;
        context.fill();
      };

      drawBand(result.outerHigh, result.outerLow, "rgba(173, 255, 47, 0.13)", "rgba(173, 255, 47, 0.025)");
      drawBand(result.p75, result.p25, "rgba(173, 255, 47, 0.28)", "rgba(173, 255, 47, 0.08)");

      context.strokeStyle = "rgba(255, 255, 255, 0.09)";
      context.lineWidth = 0.8;
      result.samplePaths.forEach((path) => {
        context.beginPath();
        for (let index = 0; index <= visibleSteps; index += 1) {
          const value = path[index];
          if (index === 0) context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        }
        context.stroke();
      });

      if (targetPrice >= min && targetPrice <= max) {
        const targetY = y(targetPrice);
        context.save();
        context.setLineDash([5, 5]);
        context.strokeStyle = "rgba(255, 194, 92, 0.7)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, targetY);
        context.lineTo(plotRight, targetY);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "rgba(255, 194, 92, 0.9)";
        context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textAlign = "right";
        context.textBaseline = "bottom";
        context.fillText("TARGET", plotRight - 5, targetY - 3);
        context.restore();
      }

      if (medianOpacity > 0) {
        context.save();
        context.globalAlpha = medianOpacity;
        context.beginPath();
        for (let index = 0; index < result.median.length; index += 1) {
          const value = result.median[index];
          if (index === 0) context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        }
        context.strokeStyle = "#adff2f";
        context.lineWidth = 2.4;
        context.stroke();
        context.restore();
      }

      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = "rgba(255, 255, 255, 0.52)";
      context.textBaseline = "bottom";
      const lastStep = result.median.length - 1;
      [0, 0.25, 0.5, 0.75, 1].forEach((fraction, labelIndex) => {
        const step = Math.round(lastStep * fraction);
        context.textAlign = labelIndex === 0 ? "left" : labelIndex === 4 ? "right" : "center";
        context.fillText(
          step === 0 ? "TODAY" : formatMonteDate(addMonteDays(new Date(), step, calendarMode), horizon).toUpperCase(),
          x(step),
          height,
        );
      });

      const requestedHoverIndex = hoverIndexRef.current;
      if (requestedHoverIndex !== null && medianOpacity > 0) {
        const hoverIndex = Math.min(visibleSteps, requestedHoverIndex);
        const hoverX = x(hoverIndex);
        const hoverValue = result.median[hoverIndex];
        const hoverY = y(hoverValue);
        context.save();
        context.setLineDash([4, 4]);
        context.strokeStyle = "rgba(255, 255, 255, 0.45)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(hoverX, padding.top);
        context.lineTo(hoverX, padding.top + chartHeight);
        context.stroke();
        context.setLineDash([]);

        context.beginPath();
        context.arc(hoverX, hoverY, 5, 0, Math.PI * 2);
        context.fillStyle = "#adff2f";
        context.fill();
        context.strokeStyle = "#151713";
        context.lineWidth = 2;
        context.stroke();

        const priceLabel = formatMoney(hoverValue, detail?.currency || "USD");
        const dayLabel = hoverIndex === 0
          ? "Today · median"
          : `${formatMonteDate(addMonteDays(new Date(), hoverIndex, calendarMode), horizon)} · day ${hoverIndex}`;
        const middleRangeLabel = `50%  ${formatAxisPrice(result.p25[hoverIndex], detail?.currency || "USD")} – ${formatAxisPrice(result.p75[hoverIndex], detail?.currency || "USD")}`;
        const wideRangeLabel = `${result.confidenceLevel}%  ${formatAxisPrice(result.outerLow[hoverIndex], detail?.currency || "USD")} – ${formatAxisPrice(result.outerHigh[hoverIndex], detail?.currency || "USD")}`;
        context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        const priceWidth = context.measureText(priceLabel).width;
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        const dayWidth = context.measureText(dayLabel).width;
        const rangeWidth = Math.max(
          context.measureText(middleRangeLabel).width,
          context.measureText(wideRangeLabel).width,
        );
        const tooltipWidth = Math.max(158, priceWidth + 22, dayWidth + 22, rangeWidth + 22);
        const tooltipHeight = 78;
        const tooltipX = hoverX + tooltipWidth + 14 > plotRight
          ? Math.max(4, hoverX - tooltipWidth - 12)
          : hoverX + 12;
        const tooltipY = Math.min(
          padding.top + chartHeight - tooltipHeight,
          Math.max(padding.top, hoverY - tooltipHeight / 2),
        );

        context.fillStyle = "#f4f0e7";
        context.strokeStyle = "#adff2f";
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 5);
        context.fill();
        context.stroke();
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.fillStyle = "#1d201b";
        context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(priceLabel, tooltipX + 11, tooltipY + 20);
        context.fillStyle = "rgba(29, 32, 27, 0.62)";
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(dayLabel, tooltipX + 11, tooltipY + 37);
        context.fillStyle = "rgba(29, 32, 27, 0.78)";
        context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(middleRangeLabel, tooltipX + 11, tooltipY + 55);
        context.fillText(wideRangeLabel, tooltipX + 11, tooltipY + 69);
        context.restore();
      }
    };

    if (reduceMotion) {
      currentProgress = 1;
      currentMedianOpacity = 1;
      draw(currentProgress, currentMedianOpacity);
    } else {
      const startedAt = window.performance.now();
      const pathDuration = 5_500;
      const medianFadeDuration = 450;
      const duration = pathDuration + medianFadeDuration;
      const animate = (now: number) => {
        const elapsed = now - startedAt;
        const pathElapsed = Math.min(1, elapsed / pathDuration);
        currentProgress = pathElapsed < 0.5
          ? 2 * pathElapsed ** 2
          : 1 - ((-2 * pathElapsed + 2) ** 2) / 2;
        const medianElapsed = Math.min(1, Math.max(0, (elapsed - pathDuration) / medianFadeDuration));
        currentMedianOpacity = 1 - (1 - medianElapsed) ** 3;
        draw(currentProgress, currentMedianOpacity);
        if (elapsed < duration) animationFrame = window.requestAnimationFrame(animate);
      };
      animationFrame = window.requestAnimationFrame(animate);
    }

    const updateHover = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const paddingLeft = 12;
      const chartWidth = rect.width - paddingLeft - 78;
      const pointerX = Math.min(chartWidth, Math.max(0, event.clientX - rect.left - paddingLeft));
      hoverIndexRef.current = Math.round((pointerX / chartWidth) * (result.median.length - 1));
      draw(currentProgress, currentMedianOpacity);
    };
    const clearHover = () => {
      hoverIndexRef.current = null;
      draw(currentProgress, currentMedianOpacity);
    };

    const observer = new ResizeObserver(() => draw(currentProgress, currentMedianOpacity));
    observer.observe(canvas);
    canvas.addEventListener("pointermove", updateHover);
    canvas.addEventListener("pointerdown", updateHover);
    canvas.addEventListener("pointerleave", clearHover);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("pointermove", updateHover);
      canvas.removeEventListener("pointerdown", updateHover);
      canvas.removeEventListener("pointerleave", clearHover);
    };
  }, [calendarMode, detail?.currency, horizon, result, startingPrice, targetPrice]);

  function runWithLivePrice() {
    if (!detail || !calibration) return;
    setStartingPrice(detail.price);
    setSeed(Date.now());
  }

  function chooseScenario(value: Exclude<MonteScenario, "custom">) {
    const preset = MONTE_SCENARIOS.find((option) => option.value === value);
    if (!preset) return;
    setScenario(value);
    setDriftAdjustment(preset.drift);
    setVolatilityMultiplier(preset.volatility);
    setSeed(Date.now());
  }

  function downloadSimulationCsv() {
    if (!result) return;
    const rows = [
      "trading_day,date,p25,median,p75,outer_low,outer_high",
      ...result.median.map((median, day) => [
        day,
        addMonteDays(new Date(), day, calendarMode).toISOString().slice(0, 10),
        result.p25[day].toFixed(6),
        median.toFixed(6),
        result.p75[day].toFixed(6),
        result.outerLow[day].toFixed(6),
        result.outerHigh[day].toFixed(6),
      ].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol.toLowerCase()}-monte-carlo-${horizon}d.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const histogramMaximum = result
    ? Math.max(1, ...result.terminalBins.map((bin) => bin.count))
    : 1;

  return (
    <section className="monte-panel panel">
      <div className="monte-heading">
        <div>
          <span className="eyebrow">PROBABILITY LAB</span>
          <h2>Monte Carlo simulator</h2>
          <p>Resample real daily market moves from the latest verified {symbol} quote.</p>
        </div>
        <span className="simulation-badge">
          BACKGROUND ENGINE · {(result?.simulations || monteSimulationCount(horizon)).toLocaleString()} PATHS
        </span>
      </div>

      <div className="monte-timeframe">
        <div className="monte-timeframe-heading">
          <span>FORECAST TIMEFRAME</span>
          <strong>{formatMonteHorizon(horizon, calendarMode)} · through {formatMonteDate(forecastDate, horizon)}</strong>
        </div>
        <div className="monte-presets" role="group" aria-label="Monte Carlo forecast timeframe">
          {MONTE_HORIZONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={horizon === option.days ? "active" : ""}
              aria-pressed={horizon === option.days}
              onClick={() => chooseHorizon(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form className="monte-custom-horizon" onSubmit={applyCustomHorizon}>
          <label>
            <span className="sr-only">Custom forecast length in {forecastDayLabel}</span>
            <input
              type="number"
              inputMode="numeric"
              min="5"
              max="1260"
              value={horizonDraft}
              onChange={(event) => setHorizonDraft(event.target.value)}
              aria-label={`Custom forecast length in ${forecastDayLabel}`}
            />
            <small>{forecastDayLabel}</small>
          </label>
          <button type="submit">Apply</button>
        </form>
      </div>

      <div className="monte-model-settings">
        <div className="monte-setting">
          <span>HISTORY WINDOW</span>
          <div role="group" aria-label="Historical calibration window">
            {MONTE_CALIBRATION_WINDOWS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={calibrationWindow === option.days ? "active" : ""}
                aria-pressed={calibrationWindow === option.days}
                onClick={() => {
                  setCalibrationWindow(option.days);
                  setSeed(Date.now());
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="monte-setting regime-setting">
          <span>REGIME WEIGHTING</span>
          <div role="group" aria-label="Market regime weighting">
            {MONTE_REGIMES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={regime === option.value ? "active" : ""}
                aria-pressed={regime === option.value}
                onClick={() => {
                  setRegime(option.value);
                  setSeed(Date.now());
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="monte-setting">
          <span>CONFIDENCE BAND</span>
          <div role="group" aria-label="Chart confidence band">
            {MONTE_CONFIDENCE_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={confidence === level ? "active" : ""}
                aria-pressed={confidence === level}
                onClick={() => setConfidence(level)}
              >
                {level}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="monte-scenario-lab">
        <div className="monte-scenario-heading">
          <div>
            <span>SCENARIO ASSUMPTIONS</span>
            <strong>{scenario === "custom"
              ? "Custom stress test"
              : MONTE_SCENARIOS.find((option) => option.value === scenario)?.label}</strong>
          </div>
          <small>Adjusts annual log-return drift and scales historical dispersion.</small>
        </div>
        <div className="monte-scenario-presets" role="group" aria-label="Monte Carlo scenario presets">
          {MONTE_SCENARIOS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={scenario === option.value ? "active" : ""}
              aria-pressed={scenario === option.value}
              onClick={() => chooseScenario(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="monte-assumption-field">
          <span>ANNUAL RETURN SHIFT</span>
          <div>
            <input
              type="number"
              min="-50"
              max="50"
              step="0.5"
              value={driftAdjustment}
              onChange={(event) => {
                setScenario("custom");
                setDriftAdjustment(Math.min(50, Math.max(-50, Number(event.target.value) || 0)));
              }}
            />
            <small>pp</small>
          </div>
        </label>
        <label className="monte-assumption-field">
          <span>VOLATILITY SCALE</span>
          <div>
            <input
              type="number"
              min="0.5"
              max="2.5"
              step="0.05"
              value={volatilityMultiplier}
              onChange={(event) => {
                setScenario("custom");
                setVolatilityMultiplier(Math.min(2.5, Math.max(0.5, Number(event.target.value) || 1)));
              }}
            />
            <small>×</small>
          </div>
        </label>
      </div>

      <div className="monte-controls">
        <div className="monte-picker-field">
          <span className="control-caption">TICKER</span>
          <SearchableTickerSelect
            value={symbol}
            options={tickerOptions}
            onChange={onSelectTicker}
            tone="dark"
            ariaLabel="Choose ticker for Monte Carlo simulator"
          />
        </div>
        <label className="calibration-field">
          <span>HIST. RETURN</span>
          <div><strong>{calibration ? calibration.annualizedReturn.toFixed(1) : "—"}</strong><small>% annual</small></div>
        </label>
        <label className="calibration-field">
          <span>HIST. VOLATILITY</span>
          <div><strong>{calibration ? calibration.annualizedVolatility.toFixed(1) : "—"}</strong><small>% annual</small></div>
        </label>
        <label>
          <span>TARGET PRICE</span>
          <div><input type="number" min="0.01" step="0.01" value={targetPrice || ""} onChange={(event) => setTargetPrice(Number(event.target.value) || 0)} /><small>{detail?.currency || "USD"}</small></div>
        </label>
        <button onClick={runWithLivePrice} disabled={!simulationReady}>
          {simulationProgress > 0 && simulationProgress < 1 ? "Re-run simulation" : "Run with live price"}
        </button>
      </div>

      {simulationReady && detail && result ? (
        <div className="monte-output">
          <div className="monte-chart-wrap">
            <div className="monte-chart-toolbar">
              <div className="monte-legend">
                <i /> Median path <span className="inner-band" /> 50% range <span className="outer-band" /> {result.confidenceLevel}% range
              </div>
              <button type="button" onClick={downloadSimulationCsv}>↓ Export CSV</button>
            </div>
            <canvas
              ref={canvasRef}
              className="monte-chart"
              aria-label={`${symbol} Monte Carlo simulation chart with ${forecastDayLabel} and price axes. Hover to inspect the median path.`}
            />
          </div>
          <div className="monte-stats">
            <div><span>STARTING PRICE</span><strong>{formatMoney(startingPrice, detail.currency)}</strong></div>
            <div><span>MEDIAN OUTCOME</span><strong>{formatMoney(result.medianTerminal, detail.currency)}</strong></div>
            <div><span>{result.confidenceLevel}% OUTCOME RANGE</span><strong>{formatMoney(result.lowTerminal, detail.currency)} — {formatMoney(result.highTerminal, detail.currency)}</strong></div>
            <div><span>CHANCE ABOVE TARGET</span><strong>{(result.probabilityAboveTarget * 100).toFixed(1)}% ± {(result.probabilityMargin * 100).toFixed(1)}</strong></div>
            <div><span>CHANCE OF A GAIN</span><strong>{(result.probabilityOfGain * 100).toFixed(1)}%</strong></div>
            <div><span>CHANCE OF 10%+ LOSS</span><strong>{(result.probabilityOfTenPercentLoss * 100).toFixed(1)}%</strong></div>
            <div><span>TYPICAL MAX DRAWDOWN</span><strong>{(result.medianMaxDrawdown * 100).toFixed(1)}%</strong></div>
            <div><span>CHANCE OF 50% DRAWDOWN</span><strong>{(result.probabilityOfHalfLoss * 100).toFixed(1)}%</strong></div>
            <div><span>MEDIAN TIME UNDER WATER</span><strong>{result.medianTimeUnderwater.toLocaleString()} days</strong></div>
            <div><span>AVG. WORST 5% RETURN</span><strong>{(result.expectedShortfallReturn * 100).toFixed(1)}%</strong></div>
            <div><span>CALIBRATION SAMPLE</span><strong>{result.observationsUsed.toLocaleString()} daily returns</strong></div>
            <div><span>BOOTSTRAP ENGINE</span><strong>{result.bootstrapMethod} · {result.expectedBlockLength}d mean block</strong></div>
          </div>
          <div className="monte-distribution">
            <div className="monte-distribution-heading">
              <div>
                <span>TERMINAL OUTCOME DISTRIBUTION</span>
                <strong>{formatMonteDate(forecastDate, horizon)} · {result.simulations.toLocaleString()} paths</strong>
              </div>
              <small>Hover over a bar for its price range and path count.</small>
            </div>
            <div className="monte-histogram" aria-label={`${symbol} simulated terminal price distribution`}>
              {result.terminalBins.map((bin, index) => {
                const containsTarget = targetPrice >= bin.low
                  && (index === result.terminalBins.length - 1 ? targetPrice <= bin.high : targetPrice < bin.high);
                return (
                  <span
                    key={`${bin.low}-${bin.high}`}
                    className={containsTarget ? "target" : ""}
                    title={`${formatMoney(bin.low, detail.currency)} – ${formatMoney(bin.high, detail.currency)} · ${bin.count.toLocaleString()} paths`}
                  >
                    <i style={{ height: `${Math.max(2, (bin.count / histogramMaximum) * 100)}%` }} />
                  </span>
                );
              })}
            </div>
            <div className="monte-distribution-axis">
              <span>{formatAxisPrice(result.terminalBins[0]?.low || result.lowTerminal, detail.currency)}</span>
              <span>Median {formatAxisPrice(result.medianTerminal, detail.currency)}</span>
              <span>{formatAxisPrice(result.terminalBins.at(-1)?.high || result.highTerminal, detail.currency)}</span>
            </div>
            <p><i /> Orange marks the bin containing your target price.</p>
          </div>
        </div>
      ) : (
        <div className="monte-empty" role="status" aria-live="polite">
          <div>
            <strong>
              {!detailReady
                ? `Waiting for the verified ${symbol} live quote…`
                : historyLoading
                  ? "Loading validated historical returns from Data Vault…"
                  : historyError
                    ? "Historical data is unavailable, so the simulation is disabled."
                    : simulationError
                      ? "The probability engine could not finish. Press re-run to try again."
                      : `Calculating ${(simulationProgress * 100).toFixed(0)}% · keeping the dashboard responsive…`}
            </strong>
            {simulationReady && !simulationError && (
              <span className="monte-progress">
                <i style={{ width: `${Math.max(3, simulationProgress * 100)}%` }} />
              </span>
            )}
          </div>
        </div>
      )}

      {simulationReady && calibration && (
        <p className="monte-calibration">
          Using <b>{calibrationObservations.toLocaleString()} daily returns</b> from{" "}
          <b>{calibration.historySymbol}</b> via {calibration.source}, with a <b>{confidence}% confidence band</b>,{" "}
          <b>{driftAdjustment >= 0 ? "+" : ""}{driftAdjustment.toFixed(1)}pp annual drift</b>, and{" "}
          <b>{volatilityMultiplier.toFixed(2)}× volatility</b>.
          {calibration.dataPack && ` Data-pack calibration spans ${calibration.lookback} and uses ${calibration.periodsPerYear} observations per year.`}
          {calibration.proxy && " GC=F supplies return history only; the starting XAUUSD price remains live spot gold."}
        </p>
      )}
      <p className="monte-note">
        Stationary block bootstrap preserves observed fat tails and volatility clustering without repeating fixed five-day boundaries. Adaptive mode favors historical blocks from the current 21-day volatility regime; Full history samples uniformly; Recent regime emphasizes the latest year. Known stock splits are corrected before returns are calculated. The ± value is a 95% sampling margin for the target probability. Exchange dates skip weekends, while crypto uses calendar days. Simulations are not forecasts or investment advice.
      </p>
    </section>
  );
}

type NewsTopic = "Earnings" | "Markets" | "Deals" | "Policy" | "Macro" | "Technology" | "Energy" | "Crypto" | "Company";

type NewsArticle = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: number;
  thumbnail: string | null;
  relatedTickers: string[];
  topic: NewsTopic;
  priority: "high" | "standard";
  directMatch: boolean;
  freshness: "breaking" | "fresh" | "standard";
  rankScore: number;
};

type NewsPayload = {
  symbol: string;
  query: string;
  source: string;
  fetchedAt: number;
  stats: {
    storyCount: number;
    publisherCount: number;
    highSignalCount: number;
    breakingCount: number;
    duplicatesRemoved: number;
    discardedIrrelevant: number;
  };
  articles: NewsArticle[];
};

type ArticleInspection = {
  status: "readable" | "metadata_only" | "blocked";
  title?: string;
  finalUrl: string;
  excerpt?: string;
  description?: string;
  wordCount?: number;
  readingMinutes?: number;
  relevanceScore?: number;
  tickerMentions?: number;
  signals?: Array<{
    label: string;
    count: number;
  }>;
  impact?: {
    direction: "positive" | "negative" | "mixed" | "unclear";
    label: string;
    confidence: "low" | "medium" | "high";
    horizon: string;
    scope: string;
    evidenceQuality: string;
    summary: string;
    drivers: Array<{
      label: string;
      direction: "positive" | "negative";
      count: number;
    }>;
    disclaimer: string;
  };
  method?: string;
  notice: string;
  error?: string;
};

const NEWS_TOPIC_OPTIONS: Array<"All" | NewsTopic> = [
  "All",
  "Earnings",
  "Markets",
  "Deals",
  "Policy",
  "Macro",
  "Technology",
  "Energy",
  "Crypto",
  "Company",
];

function formatNewsTime(timestamp: number) {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsedSeconds < 60) return "Just now";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  if (elapsedSeconds < 172_800) return "Yesterday";
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNewsUpdated(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function NewsPanel({
  initialSymbol,
  tickerOptions,
  watchlist,
}: {
  initialSymbol: string;
  tickerOptions: TickerOption[];
  watchlist: string[];
}) {
  const [newsSymbol, setNewsSymbol] = useState(initialSymbol);
  const [data, setData] = useState<NewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState<"All" | NewsTopic>("All");
  const [publisher, setPublisher] = useState("All");
  const [timeWindow, setTimeWindow] = useState<"24H" | "7D" | "ALL">("7D");
  const [headlineQuery, setHeadlineQuery] = useState("");
  const [inspection, setInspection] = useState<{
    article: NewsArticle | null;
    result: ArticleInspection | null;
    loading: boolean;
    error: string | null;
  }>({ article: null, result: null, loading: false, error: null });
  const requestIdRef = useRef(0);
  const inspectionIdRef = useRef(0);
  const newsOptions = useMemo(
    () => [
      { symbol: "MARKET", name: "Global market overview" },
      ...tickerOptions.filter((option) => option.symbol !== "MARKET"),
    ],
    [tickerOptions],
  );

  const loadNews = useCallback(async (keepCurrent = false) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    if (!keepCurrent) setData(null);
    try {
      const response = await fetch(`/api/news?symbol=${encodeURIComponent(newsSymbol)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("News request failed");
      const payload = await response.json() as NewsPayload;
      if (requestId !== requestIdRef.current || !Array.isArray(payload.articles)) return;
      setData(payload);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("No recent market news was returned for that ticker.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [newsSymbol]);

  useEffect(() => {
    void loadNews(false);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadNews(true);
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [loadNews]);

  useEffect(() => {
    setTopic("All");
    setPublisher("All");
    setTimeWindow("7D");
    setHeadlineQuery("");
    setInspection({ article: null, result: null, loading: false, error: null });
  }, [newsSymbol]);

  const inspectArticle = useCallback(async (article: NewsArticle) => {
    const requestId = inspectionIdRef.current + 1;
    inspectionIdRef.current = requestId;
    setInspection({ article, result: null, loading: true, error: null });
    try {
      const response = await fetch("/api/article-reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: article.id,
          symbol: newsSymbol,
        }),
      });
      const payload = await response.json() as ArticleInspection;
      if (requestId !== inspectionIdRef.current) return;
      if (!response.ok && payload.status !== "blocked") throw new Error("Article inspection failed");
      setInspection({ article, result: payload, loading: false, error: null });
    } catch {
      if (requestId !== inspectionIdRef.current) return;
      setInspection({
        article,
        result: null,
        loading: false,
        error: "The article reader could not inspect this publisher page right now.",
      });
    }
  }, [newsSymbol]);

  function closeInspection() {
    inspectionIdRef.current += 1;
    setInspection({ article: null, result: null, loading: false, error: null });
  }

  const publishers = useMemo(
    () => [...new Set((data?.articles || []).map((article) => article.publisher))].sort(),
    [data],
  );
  const filteredArticles = useMemo(() => {
    const now = Date.now() / 1000;
    const normalizedQuery = headlineQuery.trim().toUpperCase();
    return (data?.articles || []).filter((article) => {
      const age = Math.max(0, now - article.publishedAt);
      const insideWindow = timeWindow === "ALL"
        || (timeWindow === "24H" ? age <= 86_400 : age <= 604_800);
      return insideWindow
        && (topic === "All" || article.topic === topic)
        && (publisher === "All" || article.publisher === publisher)
        && (
          !normalizedQuery
          || article.title.toUpperCase().includes(normalizedQuery)
          || article.publisher.toUpperCase().includes(normalizedQuery)
          || article.relatedTickers.some((ticker) => ticker.toUpperCase().includes(normalizedQuery))
        );
    });
  }, [data, headlineQuery, publisher, timeWindow, topic]);
  const lead = filteredArticles[0] || null;
  const remaining = filteredArticles.slice(1);
  const filteredPublishers = new Set(filteredArticles.map((article) => article.publisher)).size;
  const filteredHighSignal = filteredArticles.filter((article) => article.priority === "high").length;
  const newestStory = filteredArticles.reduce(
    (latest, article) => Math.max(latest, article.publishedAt),
    0,
  );

  return (
    <section className="news-page">
      <div className="news-hero">
        <div>
          <span className="eyebrow">LIVE NEWS DESK</span>
          <h1>Markets, without the noise.</h1>
          <p>
            Follow current reporting for the whole market, a watchlist ticker, or any Yahoo symbol.
          </p>
        </div>
        <div className="news-live-badge">
          <i />
          <span>
            <strong>REFINED LIVE FEED</strong>
            <small>Refreshes every 30 seconds</small>
          </span>
        </div>
      </div>

      <section className="news-toolbar panel">
        <div className="news-picker-field">
          <span className="control-caption">NEWS FOR</span>
          <SearchableTickerSelect
            value={newsSymbol}
            options={newsOptions}
            onChange={setNewsSymbol}
            ariaLabel="Choose ticker for market news"
          />
        </div>
        <div className="news-watchlist-filter">
          <span>WATCHLIST SHORTCUTS</span>
          <div>
            <button
              type="button"
              className={newsSymbol === "MARKET" ? "active" : ""}
              onClick={() => setNewsSymbol("MARKET")}
            >
              Market
            </button>
            {watchlist.map((item) => (
              <button
                type="button"
                className={newsSymbol === item ? "active" : ""}
                key={item}
                onClick={() => setNewsSymbol(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="news-refresh"
          onClick={() => void loadNews(true)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh news"}
        </button>
      </section>

      {data && (
        <>
          <section className="news-refine-panel panel" aria-label="Refine market news">
            <div className="news-topic-filter">
              <span>TOPIC</span>
              <div>
                {NEWS_TOPIC_OPTIONS.map((option) => {
                  const count = option === "All"
                    ? data.articles.length
                    : data.articles.filter((article) => article.topic === option).length;
                  if (option !== "All" && !count) return null;
                  return (
                    <button
                      type="button"
                      className={topic === option ? "active" : ""}
                      aria-pressed={topic === option}
                      onClick={() => setTopic(option)}
                      key={option}
                    >
                      {option}<small>{count}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="news-refine-controls">
              <label>
                <span>SOURCE</span>
                <select value={publisher} onChange={(event) => setPublisher(event.target.value)}>
                  <option value="All">All publishers</option>
                  {publishers.map((item) => <option value={item} key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>WINDOW</span>
                <select value={timeWindow} onChange={(event) => setTimeWindow(event.target.value as "24H" | "7D" | "ALL")}>
                  <option value="24H">Last 24 hours</option>
                  <option value="7D">Last 7 days</option>
                  <option value="ALL">All returned</option>
                </select>
              </label>
              <label className="news-headline-search">
                <span>SEARCH THIS FEED</span>
                <input
                  type="search"
                  value={headlineQuery}
                  onChange={(event) => setHeadlineQuery(event.target.value)}
                  placeholder="Headline, source, or ticker"
                />
              </label>
            </div>
          </section>

          <div className="news-signal-strip">
            <div>
              <span>REFINED STORIES</span>
              <strong>{filteredArticles.length}</strong>
              <small>
                {data.stats.discardedIrrelevant || 0} off-topic · {data.stats.duplicatesRemoved} duplicate
                {data.stats.duplicatesRemoved === 1 ? "" : "s"} removed
              </small>
            </div>
            <div>
              <span>PUBLISHERS</span>
              <strong>{filteredPublishers}</strong>
              <small>In the current view</small>
            </div>
            <div>
              <span>HIGH-SIGNAL</span>
              <strong>{filteredHighSignal}</strong>
              <small>{data.stats.breakingCount || 0} breaking · earnings, deals, policy</small>
            </div>
            <div>
              <span>NEWEST STORY</span>
              <strong>{newestStory ? formatNewsTime(newestStory) : "—"}</strong>
              <small>Feed checked {formatNewsUpdated(data.fetchedAt)}</small>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="news-error" role="status">
          <strong>News feed unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void loadNews(false)}>Try again</button>
        </div>
      )}

      {loading && !lead && (
        <div className="news-loading panel" role="status">
          <i />
          <span>Gathering the latest {newsSymbol === "MARKET" ? "market" : newsSymbol} headlines…</span>
        </div>
      )}

      {lead && (
        <>
          <article
            className={`news-lead panel ${lead.thumbnail ? "" : "no-image"}`}
          >
            {lead.thumbnail && (
              <div className="news-lead-image">
                <img src={lead.thumbnail} alt="" />
              </div>
            )}
            <div className="news-lead-copy">
              <div className="news-meta">
                <span>TOP REFINED STORY</span>
                <span>{formatNewsTime(lead.publishedAt)}</span>
              </div>
              <div className="news-story-flags">
                {lead.freshness === "breaking" && <b className="news-breaking">BREAKING</b>}
                <span>{lead.topic}</span>
                {lead.priority === "high" && <strong>HIGH-SIGNAL</strong>}
                {lead.directMatch && newsSymbol !== "MARKET" && <i>DIRECT {newsSymbol} MATCH</i>}
              </div>
              <h2>{lead.title}</h2>
              <div className="news-byline">
                <strong>{lead.publisher}</strong>
                <div className="news-article-actions">
                  <button type="button" onClick={() => void inspectArticle(lead)}>
                    Inspect article
                  </button>
                  <a href={lead.url} target="_blank" rel="noreferrer">Publisher ↗</a>
                </div>
              </div>
              {!!lead.relatedTickers.length && (
                <div className="news-ticker-tags">
                  {lead.relatedTickers.slice(0, 5).map((ticker) => <span key={ticker}>{ticker}</span>)}
                </div>
              )}
            </div>
          </article>

          <div className="news-section-heading">
            <div>
              <span className="eyebrow">LATEST REPORTING</span>
              <h2>
                {newsSymbol === "MARKET" ? "Market-wide headlines" : `${newsSymbol} news`}
                {topic !== "All" ? ` · ${topic}` : ""}
              </h2>
            </div>
            <span>
              {filteredArticles.length.toLocaleString()} refined stories · {data?.source}
            </span>
          </div>

          <div className="news-grid">
            {remaining.map((article, index) => (
              <article
                className="news-card panel"
                key={article.id}
              >
                <div className={`news-card-media ${article.thumbnail ? "" : "no-image"}`}>
                  {article.thumbnail
                    ? <img src={article.thumbnail} alt="" />
                    : <span>{String(index + 2).padStart(2, "0")}</span>}
                </div>
                <div className="news-card-copy">
                  <div className="news-meta">
                    <span>{article.publisher}</span>
                    <span>{formatNewsTime(article.publishedAt)}</span>
                  </div>
                  <div className="news-card-signals">
                    {article.freshness === "breaking" && <b className="news-breaking">BREAKING</b>}
                    <span>{article.topic}</span>
                    {article.priority === "high" && <strong>HIGH-SIGNAL</strong>}
                    {article.directMatch && newsSymbol !== "MARKET" && <i>DIRECT MATCH</i>}
                  </div>
                  <h3>{article.title}</h3>
                  <div className="news-card-footer">
                    <span>{article.relatedTickers.slice(0, 3).join(" · ") || newsSymbol}</span>
                    <div className="news-article-actions">
                      <button type="button" onClick={() => void inspectArticle(article)}>
                        Inspect
                      </button>
                      <a href={article.url} target="_blank" rel="noreferrer">Open ↗</a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="news-source-note">
            Headlines are aggregated by {data?.source}, ranked for recency and ticker relevance, and clustered to remove near-duplicates.
            The Article Inspector reads public publisher text on demand and evaluates it with transparent keyword rules.
            It does not use ChatGPT, send article text to an AI API, or bypass publisher access controls.
          </p>
        </>
      )}

      {inspection.article && (
        <div className="news-inspector-backdrop" role="presentation" onClick={closeInspection}>
          <section
            className="news-inspector panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Article Inspector: ${inspection.article.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="news-inspector-header">
              <div>
                <span className="eyebrow">NO-AI ARTICLE INSPECTOR</span>
                <h2>{inspection.result?.title || inspection.article.title}</h2>
                <p>{inspection.article.publisher} · Public-page analysis</p>
              </div>
              <button type="button" onClick={closeInspection} aria-label="Close Article Inspector">×</button>
            </div>

            {inspection.loading && (
              <div className="news-inspector-loading" role="status">
                <i />
                <div>
                  <strong>Reading the publisher page…</strong>
                  <span>Extracting visible article text and checking financial signals.</span>
                </div>
              </div>
            )}

            {inspection.error && (
              <div className="news-inspector-blocked" role="status">
                <strong>Inspector unavailable</strong>
                <span>{inspection.error}</span>
              </div>
            )}

            {inspection.result?.status === "blocked" && (
              <div className="news-inspector-blocked" role="status">
                <strong>Publisher text is not publicly readable</strong>
                <span>{inspection.result.error}</span>
                <small>{inspection.result.notice}</small>
              </div>
            )}

            {inspection.result && inspection.result.status !== "blocked" && (
              <>
                <div className="news-inspector-metrics">
                  <div>
                    <span>STOCK RELEVANCE</span>
                    <strong>{inspection.result.relevanceScore}%</strong>
                    <small>Rule-based score</small>
                  </div>
                  <div>
                    <span>WORDS ANALYZED</span>
                    <strong>{inspection.result.wordCount?.toLocaleString()}</strong>
                    <small>≈ {inspection.result.readingMinutes} min read</small>
                  </div>
                  <div>
                    <span>{newsSymbol === "MARKET" ? "MARKET TERMS" : `${newsSymbol} MENTIONS`}</span>
                    <strong>{newsSymbol === "MARKET" ? "LIVE" : inspection.result.tickerMentions}</strong>
                    <small>{inspection.result.method}</small>
                  </div>
                </div>
                {inspection.result.impact && (
                  <div className={`news-event-impact ${inspection.result.impact.direction}`}>
                    <div className="news-event-impact-heading">
                      <div>
                        <span>LIKELY EVENT IMPACT</span>
                        <h3>{inspection.result.impact.label}</h3>
                      </div>
                      <strong>{inspection.result.impact.confidence} confidence</strong>
                    </div>
                    <p>{inspection.result.impact.summary}</p>
                    <div className="news-event-impact-meta">
                      <span><small>HORIZON</small>{inspection.result.impact.horizon}</span>
                      <span><small>SCOPE</small>{inspection.result.impact.scope}</span>
                      <span><small>EVIDENCE</small>{inspection.result.impact.evidenceQuality}</span>
                    </div>
                    {!!inspection.result.impact.drivers.length && (
                      <div className="news-event-drivers">
                        {inspection.result.impact.drivers.map((driver) => (
                          <span className={driver.direction} key={`${driver.direction}-${driver.label}`}>
                            <i>{driver.direction === "positive" ? "↗" : "↘"}</i>
                            {driver.label}
                            {driver.count > 1 && <small>×{driver.count}</small>}
                          </span>
                        ))}
                      </div>
                    )}
                    <small className="news-event-impact-disclaimer">
                      {inspection.result.impact.disclaimer}
                    </small>
                  </div>
                )}
                {!!inspection.result.signals?.length && (
                  <div className="news-inspector-signals">
                    <span>FULL-TEXT SIGNALS</span>
                    <div>
                      {inspection.result.signals.map((signal) => (
                        <strong key={signal.label}>{signal.label}<small>{signal.count}</small></strong>
                      ))}
                    </div>
                  </div>
                )}
                {inspection.result.description && (
                  <div className="news-inspector-description">
                    <span>PUBLISHER DESCRIPTION</span>
                    <p>{inspection.result.description}</p>
                  </div>
                )}
                <div className="news-inspector-excerpt">
                  <span>PUBLIC ARTICLE EXCERPT</span>
                  <p>{inspection.result.excerpt}</p>
                </div>
              </>
            )}

            <div className="news-inspector-footer">
              <span>
                {inspection.result?.notice || "Article text stays between this dashboard and the publisher."}
              </span>
              <a href={inspection.result?.finalUrl || inspection.article.url} target="_blank" rel="noreferrer">
                Open full article ↗
              </a>
            </div>
          </section>
        </div>
      )}

      {data && !loading && !lead && (
        <div className="news-filter-empty panel">
          <span>0</span>
          <div>
            <strong>
              {data.articles.length ? "No stories match these filters" : "No stock-relevant stories right now"}
            </strong>
            <small>
              {data.articles.length
                ? "Try All topics, a wider time window, or clear the feed search."
                : "The feed is withholding unrelated filler. Refresh later for newly matched reporting."}
            </small>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!data.articles.length) {
                void loadNews(true);
                return;
              }
              setTopic("All");
              setPublisher("All");
              setTimeWindow("ALL");
              setHeadlineQuery("");
            }}
          >
            {data.articles.length ? "Clear filters" : "Refresh feed"}
          </button>
        </div>
      )}
    </section>
  );
}

const MARKET_X_ACCOUNTS = [
  { handle: "ReutersBiz", name: "Reuters Business", note: "Companies, markets and global business" },
  { handle: "markets", name: "Bloomberg Markets", note: "Global markets and macro coverage" },
  { handle: "YahooFinance", name: "Yahoo Finance", note: "Market headlines and company news" },
  { handle: "CNBC", name: "CNBC", note: "Business news and market updates" },
  { handle: "WSJmarkets", name: "WSJ Markets", note: "Markets reporting from The Wall Street Journal" },
  { handle: "MarketWatch", name: "MarketWatch", note: "Stocks, investing and personal finance" },
];

function xQueryFor(symbol: string) {
  if (symbol === "MARKET") return "(stocks OR markets OR investing) lang:en -filter:retweets";
  if (symbol === "XAUUSD") return "(gold OR XAUUSD OR $GC) lang:en -filter:retweets";
  if (symbol === "^GSPC") return "(\"S&P 500\" OR $SPY) lang:en -filter:retweets";
  if (symbol === "^DJI") return "(\"Dow Jones\" OR $DIA) lang:en -filter:retweets";
  if (symbol === "^IXIC") return "(Nasdaq OR $QQQ) lang:en -filter:retweets";
  if (symbol === "BTC-USD") return "(Bitcoin OR $BTC) lang:en -filter:retweets";
  if (symbol === "ETH-USD") return "(Ethereum OR $ETH) lang:en -filter:retweets";
  const cashtag = symbol.replace(/[^A-Z0-9.]/g, "");
  return `($${cashtag} OR ${symbol}) lang:en -filter:retweets`;
}

function xSearchUrl(query: string, filter: "live" | "top" | "media" = "live") {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=${filter}`;
}

function XTrackerPanel({
  initialSymbol,
  tickerOptions,
  watchlist,
}: {
  initialSymbol: string;
  tickerOptions: TickerOption[];
  watchlist: string[];
}) {
  const [trackerSymbol, setTrackerSymbol] = useState(initialSymbol);
  const [customQuery, setCustomQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const trackerOptions = useMemo(
    () => [
      { symbol: "MARKET", name: "Global market conversation" },
      ...tickerOptions.filter((option) => option.symbol !== "MARKET"),
    ],
    [tickerOptions],
  );
  const activeQuery = xQueryFor(trackerSymbol);
  const customSearchUrl = customQuery.trim() ? xSearchUrl(customQuery.trim()) : "";

  async function copyActiveQuery() {
    try {
      await navigator.clipboard.writeText(activeQuery);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1_800);
  }

  return (
    <section className="x-page">
      <div className="x-hero">
        <div className="x-hero-mark" aria-hidden="true">X</div>
        <div>
          <span className="eyebrow">X / TWITTER TRACKER</span>
          <h1>Follow the market conversation.</h1>
          <p>
            Launch precise, live searches for your watchlist, cashtags, media, and trusted market accounts.
          </p>
        </div>
        <div className="x-mode">
          <span>FREE MODE</span>
          <strong>FIRST-PARTY SEARCH LINKS</strong>
          <small>No copied posts, invented counts, or simulated sentiment.</small>
        </div>
      </div>

      <section className="x-toolbar panel">
        <div className="x-picker-field">
          <span className="control-caption">TRACK CONVERSATION FOR</span>
          <SearchableTickerSelect
            value={trackerSymbol}
            options={trackerOptions}
            onChange={setTrackerSymbol}
            ariaLabel="Choose ticker for X tracker"
          />
        </div>
        <div className="x-query-preview">
          <span>ACTIVE X QUERY</span>
          <code>{activeQuery}</code>
        </div>
        <button type="button" className="x-copy" onClick={() => void copyActiveQuery()}>
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy query"}
        </button>
      </section>

      <div className="x-action-grid">
        <a href={xSearchUrl(activeQuery, "live")} target="_blank" rel="noreferrer" className="x-action-card live">
          <span>01</span>
          <div>
            <small>REAL-TIME</small>
            <h2>Latest posts</h2>
            <p>Open the newest matching posts in chronological order.</p>
          </div>
          <strong>OPEN X ↗</strong>
        </a>
        <a href={xSearchUrl(activeQuery, "top")} target="_blank" rel="noreferrer" className="x-action-card">
          <span>02</span>
          <div>
            <small>DISCOVERY</small>
            <h2>Top posts</h2>
            <p>See the conversation X currently ranks as most relevant.</p>
          </div>
          <strong>OPEN X ↗</strong>
        </a>
        <a href={xSearchUrl(activeQuery, "media")} target="_blank" rel="noreferrer" className="x-action-card">
          <span>03</span>
          <div>
            <small>CHARTS + VIDEO</small>
            <h2>Media posts</h2>
            <p>Jump directly to posts containing images and market clips.</p>
          </div>
          <strong>OPEN X ↗</strong>
        </a>
      </div>

      <section className="x-custom-search panel">
        <div>
          <span className="eyebrow">CUSTOM SEARCH</span>
          <h2>Track any phrase, handle, or hashtag.</h2>
          <p>Use normal X search operators—for example, <code>from:ReutersBiz oil</code> or <code>#earnings lang:en</code>.</p>
        </div>
        <div className="x-custom-controls">
          <input
            value={customQuery}
            onChange={(event) => setCustomQuery(event.target.value)}
            placeholder="Type a keyword, @handle, or #hashtag"
            aria-label="Custom X search query"
          />
          <a
            href={customSearchUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className={customSearchUrl ? "" : "disabled"}
            aria-disabled={!customSearchUrl}
            onClick={(event) => {
              if (!customSearchUrl) event.preventDefault();
            }}
          >
            Search live on X ↗
          </a>
        </div>
      </section>

      <div className="x-section-heading">
        <div>
          <span className="eyebrow">WATCHLIST TRACKER</span>
          <h2>One tap to the live tape</h2>
        </div>
        <span>{watchlist.length} saved tickers</span>
      </div>

      <div className="x-watchlist-grid">
        {watchlist.map((ticker, index) => {
          const query = xQueryFor(ticker);
          return (
            <a
              href={xSearchUrl(query)}
              target="_blank"
              rel="noreferrer"
              className="x-watch-card panel"
              key={ticker}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <small>CASHTAG TRACKER</small>
                <h3>{ticker}</h3>
                <code>{query}</code>
              </div>
              <strong>LIVE ↗</strong>
            </a>
          );
        })}
      </div>

      <div className="x-section-heading accounts">
        <div>
          <span className="eyebrow">MARKET SOURCES</span>
          <h2>Publisher shortcuts</h2>
        </div>
        <span>Opens official X profiles</span>
      </div>

      <div className="x-account-grid">
        {MARKET_X_ACCOUNTS.map((account) => (
          <a
            href={`https://x.com/${account.handle}`}
            target="_blank"
            rel="noreferrer"
            className="x-account-card panel"
            key={account.handle}
          >
            <span className="x-account-avatar">{account.name.slice(0, 1)}</span>
            <div>
              <strong>{account.name}</strong>
              <small>@{account.handle}</small>
              <p>{account.note}</p>
            </div>
            <i>↗</i>
          </a>
        ))}
      </div>

      <div className="x-api-note">
        <strong>Why posts are not copied into Ledger</strong>
        <p>
          X requires authenticated, pay-per-use API access to retrieve recent posts programmatically. This free mode sends each query directly to X, where results remain current and governed by your X account.
        </p>
      </div>
    </section>
  );
}

const TRUTH_PROFILE_PRESETS = [
  { handle: "realDonaldTrump", name: "Donald J. Trump", note: "Policy announcements and political commentary" },
  { handle: "DonaldJTrumpJr", name: "Donald Trump Jr.", note: "Political and business commentary" },
  { handle: "TeamTrump", name: "Team Trump", note: "Campaign announcements and media" },
  { handle: "truthsocial", name: "Truth Social", note: "Platform announcements and updates" },
];

function truthQueryFor(symbol: string) {
  if (symbol === "MARKET") return "stock market";
  if (symbol === "XAUUSD") return "gold";
  if (symbol === "^GSPC") return "S&P 500";
  if (symbol === "^DJI") return "Dow Jones";
  if (symbol === "^IXIC") return "Nasdaq";
  if (symbol === "BTC-USD") return "Bitcoin";
  if (symbol === "ETH-USD") return "Ethereum";
  return symbol;
}

function truthSearchUrl(query: string) {
  return `https://truthsocial.com/search?q=${encodeURIComponent(query)}`;
}

function TruthSocialPanel({
  initialSymbol,
  tickerOptions,
  watchlist,
}: {
  initialSymbol: string;
  tickerOptions: TickerOption[];
  watchlist: string[];
}) {
  const [truthSymbol, setTruthSymbol] = useState(initialSymbol);
  const [customQuery, setCustomQuery] = useState("");
  const truthOptions = useMemo(
    () => [
      { symbol: "MARKET", name: "Market-wide conversation" },
      ...tickerOptions.filter((option) => option.symbol !== "MARKET"),
    ],
    [tickerOptions],
  );
  const activeQuery = truthQueryFor(truthSymbol);
  const customUrl = customQuery.trim() ? truthSearchUrl(customQuery.trim()) : "";
  const truthTopics = [
    {
      label: "TICKER WATCH",
      title: truthSymbol === "MARKET" ? "Stock market" : truthSymbol,
      query: activeQuery,
      note: "Search the current ticker or market phrase.",
    },
    {
      label: "POLICY RISK",
      title: "Tariffs + trade",
      query: "tariffs trade",
      note: "Follow posts about trade actions and tariff policy.",
    },
    {
      label: "MACRO WATCH",
      title: "Rates + inflation",
      query: "interest rates inflation",
      note: "Track macro language that can move bonds and equities.",
    },
  ];

  return (
    <section className="truth-page">
      <div className="truth-hero">
        <div className="truth-mark" aria-hidden="true">T</div>
        <div>
          <span className="eyebrow">TRUTH SOCIAL MONITOR</span>
          <h1>Watch policy before it reaches the tape.</h1>
          <p>
            Track ticker mentions, market-sensitive topics, and high-impact profiles directly on Truth Social.
          </p>
        </div>
        <div className="truth-status">
          <span>DIRECT MODE</span>
          <strong>FIRST-PARTY RESULTS</strong>
          <small>Searches open on Truth Social and may require an account.</small>
        </div>
      </div>

      <section className="truth-toolbar panel">
        <div className="truth-picker-field">
          <span className="control-caption">MONITOR FOR</span>
          <SearchableTickerSelect
            value={truthSymbol}
            options={truthOptions}
            onChange={setTruthSymbol}
            ariaLabel="Choose ticker for Truth Social monitor"
          />
        </div>
        <div className="truth-active-query">
          <span>ACTIVE SEARCH</span>
          <code>{activeQuery}</code>
        </div>
        <a href={truthSearchUrl(activeQuery)} target="_blank" rel="noreferrer">
          Search Truth Social ↗
        </a>
      </section>

      <div className="truth-topic-grid">
        {truthTopics.map((topic, index) => (
          <a
            href={truthSearchUrl(topic.query)}
            target="_blank"
            rel="noreferrer"
            className={`truth-topic-card ${index === 0 ? "primary" : ""}`}
            key={topic.title}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>{topic.label}</small>
              <h2>{topic.title}</h2>
              <p>{topic.note}</p>
            </div>
            <strong>MONITOR ↗</strong>
          </a>
        ))}
      </div>

      <section className="truth-custom panel">
        <div>
          <span className="eyebrow">CUSTOM MONITOR</span>
          <h2>Search a person, policy, company, or phrase.</h2>
          <p>Use a focused phrase such as “Federal Reserve”, “Nvidia”, “oil prices”, or a public figure’s name.</p>
        </div>
        <div className="truth-custom-controls">
          <input
            value={customQuery}
            onChange={(event) => setCustomQuery(event.target.value)}
            placeholder="Enter a Truth Social search"
            aria-label="Custom Truth Social search"
          />
          <a
            href={customUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className={customUrl ? "" : "disabled"}
            aria-disabled={!customUrl}
            onClick={(event) => {
              if (!customUrl) event.preventDefault();
            }}
          >
            Open search ↗
          </a>
        </div>
      </section>

      <div className="truth-section-heading">
        <div>
          <span className="eyebrow">WATCHLIST MONITOR</span>
          <h2>Your tickers on Truth Social</h2>
        </div>
        <span>{watchlist.length} direct searches</span>
      </div>

      <div className="truth-watchlist-grid">
        {watchlist.map((ticker, index) => (
          <a
            href={truthSearchUrl(truthQueryFor(ticker))}
            target="_blank"
            rel="noreferrer"
            className="truth-watch-card panel"
            key={ticker}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>WATCHLIST TERM</small>
              <h3>{ticker}</h3>
              <code>{truthQueryFor(ticker)}</code>
            </div>
            <strong>OPEN ↗</strong>
          </a>
        ))}
      </div>

      <div className="truth-section-heading profiles">
        <div>
          <span className="eyebrow">PROFILE MONITOR</span>
          <h2>High-impact profile shortcuts</h2>
        </div>
        <span>Direct profile links</span>
      </div>

      <div className="truth-profile-grid">
        {TRUTH_PROFILE_PRESETS.map((profile) => (
          <a
            href={`https://truthsocial.com/@${profile.handle}`}
            target="_blank"
            rel="noreferrer"
            className="truth-profile-card panel"
            key={profile.handle}
          >
            <span>{profile.name.slice(0, 1)}</span>
            <div>
              <strong>{profile.name}</strong>
              <small>@{profile.handle}</small>
              <p>{profile.note}</p>
            </div>
            <i>↗</i>
          </a>
        ))}
      </div>

      <div className="truth-access-note">
        <strong>Direct-access monitor</strong>
        <p>
          Truth Social currently blocks automated requests from this dashboard’s hosting network. Ledger therefore opens first-party searches and profiles instead of scraping posts or showing stale cached copies.
        </p>
      </div>
    </section>
  );
}

type MegaCapStock = {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  marketCap: number;
  currency: string;
  exchange: string;
  marketState: string;
};

type MegaCapPayload = {
  source: string;
  fetchedAt: string;
  count: number;
  stocks: MegaCapStock[];
};

type MarketDirectoryPayload = {
  marketId: string;
  marketName: string;
  source: string;
  fetchedAt: string;
  offset: number;
  count: number;
  providerCount: number;
  total: number;
  listings: MegaCapStock[];
};

type SparklinePoint = {
  time: number;
  value: number;
};

type SparklinePayload = {
  range: string;
  interval: string;
  source: string;
  charts: Array<{
    symbol: string;
    points: SparklinePoint[];
  }>;
};

type MegaCapSort = "marketCap" | "changePercent" | "price" | "name";
type MarketCategory = "stocks" | "global" | "commodities" | "forex" | "crypto" | "indices" | "etfs";
type StandardBoardCategory = Exclude<MarketCategory, "stocks" | "global">;
type CategoryQuoteSort = "default" | "changePercent" | "price" | "name";
type QuoteBoardConfig = {
  eyebrow: string;
  title: string;
  description: string;
  instruments: TickerOption[];
};

type GlobalStockMarket = {
  id: string;
  name: string;
  region: string;
  exchange: string;
  instruments: TickerOption[];
};

const MARKET_CATEGORY_OPTIONS: Array<{
  value: MarketCategory;
  label: string;
  shortLabel: string;
}> = [
  { value: "stocks", label: "Stocks · Mega 50", shortLabel: "50" },
  { value: "global", label: "Global stocks", shortLabel: "GL" },
  { value: "commodities", label: "Commodities", shortLabel: "CM" },
  { value: "forex", label: "Forex", shortLabel: "FX" },
  { value: "crypto", label: "Crypto", shortLabel: "CR" },
  { value: "indices", label: "Indices", shortLabel: "IX" },
  { value: "etfs", label: "ETFs", shortLabel: "ETF" },
];

const CATEGORY_BOARDS: Record<StandardBoardCategory, QuoteBoardConfig> = {
  commodities: {
    eyebrow: "GLOBAL FUTURES BOARD",
    title: "Commodities",
    description: "Spot gold and major energy, metal, and agricultural futures in one continuously updating board.",
    instruments: [
      { symbol: "XAUUSD", name: "Gold spot / U.S. dollar" },
      { symbol: "GC=F", name: "Gold futures" },
      { symbol: "SI=F", name: "Silver futures" },
      { symbol: "CL=F", name: "WTI crude oil futures" },
      { symbol: "BZ=F", name: "Brent crude oil futures" },
      { symbol: "NG=F", name: "Natural gas futures" },
      { symbol: "HG=F", name: "Copper futures" },
      { symbol: "PL=F", name: "Platinum futures" },
      { symbol: "ZC=F", name: "Corn futures" },
      { symbol: "ZW=F", name: "Wheat futures" },
      { symbol: "ZS=F", name: "Soybean futures" },
      { symbol: "KC=F", name: "Coffee futures" },
    ],
  },
  forex: {
    eyebrow: "GLOBAL CURRENCY BOARD",
    title: "Foreign exchange",
    description: "Major, cross, and emerging-market currency pairs with current prices and session moves.",
    instruments: [
      { symbol: "EURUSD=X", name: "Euro / U.S. dollar" },
      { symbol: "GBPUSD=X", name: "British pound / U.S. dollar" },
      { symbol: "JPY=X", name: "U.S. dollar / Japanese yen" },
      { symbol: "AUDUSD=X", name: "Australian dollar / U.S. dollar" },
      { symbol: "NZDUSD=X", name: "New Zealand dollar / U.S. dollar" },
      { symbol: "USDCAD=X", name: "U.S. dollar / Canadian dollar" },
      { symbol: "USDCHF=X", name: "U.S. dollar / Swiss franc" },
      { symbol: "EURGBP=X", name: "Euro / British pound" },
      { symbol: "EURJPY=X", name: "Euro / Japanese yen" },
      { symbol: "GBPJPY=X", name: "British pound / Japanese yen" },
      { symbol: "ZAR=X", name: "U.S. dollar / South African rand" },
      { symbol: "USDINR=X", name: "U.S. dollar / Indian rupee" },
    ],
  },
  crypto: {
    eyebrow: "DIGITAL ASSET BOARD",
    title: "Crypto",
    description: "A live board for the most widely followed digital assets, quoted against the U.S. dollar.",
    instruments: [
      { symbol: "BTC-USD", name: "Bitcoin" },
      { symbol: "ETH-USD", name: "Ethereum" },
      { symbol: "USDT-USD", name: "Tether" },
      { symbol: "BNB-USD", name: "BNB" },
      { symbol: "XRP-USD", name: "XRP" },
      { symbol: "SOL-USD", name: "Solana" },
      { symbol: "USDC-USD", name: "USDC" },
      { symbol: "DOGE-USD", name: "Dogecoin" },
      { symbol: "ADA-USD", name: "Cardano" },
      { symbol: "AVAX-USD", name: "Avalanche" },
      { symbol: "LINK-USD", name: "Chainlink" },
      { symbol: "DOT-USD", name: "Polkadot" },
    ],
  },
  indices: {
    eyebrow: "WORLD INDEX BOARD",
    title: "Indices",
    description: "Benchmark equity and volatility indices spanning Africa, the Americas, Europe, and Asia-Pacific.",
    instruments: [
      { symbol: "^GSPC", name: "S&P 500" },
      { symbol: "^DJI", name: "Dow Jones Industrial Average" },
      { symbol: "^IXIC", name: "Nasdaq Composite" },
      { symbol: "^RUT", name: "Russell 2000" },
      { symbol: "^VIX", name: "CBOE Volatility Index" },
      { symbol: "^J203.JO", name: "FTSE/JSE All Share Index" },
      { symbol: "^FTSE", name: "FTSE 100" },
      { symbol: "^GDAXI", name: "DAX Performance Index" },
      { symbol: "^FCHI", name: "CAC 40" },
      { symbol: "^STOXX50E", name: "EURO STOXX 50" },
      { symbol: "^N225", name: "Nikkei 225" },
      { symbol: "^HSI", name: "Hang Seng Index" },
      { symbol: "^AXJO", name: "S&P/ASX 200" },
      { symbol: "^BSESN", name: "S&P BSE SENSEX" },
      { symbol: "^KS11", name: "KOSPI Composite" },
      { symbol: "^GSPTSE", name: "S&P/TSX Composite" },
      { symbol: "^BVSP", name: "Bovespa Index" },
      { symbol: "^MXX", name: "S&P/BMV IPC" },
      { symbol: "^STI", name: "Straits Times Index" },
    ],
  },
  etfs: {
    eyebrow: "EXCHANGE-TRADED FUND BOARD",
    title: "ETFs",
    description: "Core equity, bond, commodity, and international exchange-traded funds in a single board.",
    instruments: [
      { symbol: "SPY", name: "SPDR S&P 500 ETF Trust" },
      { symbol: "QQQ", name: "Invesco QQQ Trust" },
      { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF" },
      { symbol: "IWM", name: "iShares Russell 2000 ETF" },
      { symbol: "VTI", name: "Vanguard Total Stock Market ETF" },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF" },
      { symbol: "GLD", name: "SPDR Gold Shares" },
      { symbol: "SLV", name: "iShares Silver Trust" },
      { symbol: "USO", name: "United States Oil Fund" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF" },
      { symbol: "HYG", name: "iShares High Yield Corporate Bond ETF" },
      { symbol: "EEM", name: "iShares MSCI Emerging Markets ETF" },
    ],
  },
};

const GLOBAL_STOCK_MARKETS: GlobalStockMarket[] = [
  {
    id: "south-africa",
    name: "South Africa",
    region: "Africa",
    exchange: "Johannesburg Stock Exchange",
    instruments: [
      { symbol: "NPN.JO", name: "Naspers" },
      { symbol: "AGL.JO", name: "Anglo American" },
      { symbol: "CFR.JO", name: "Richemont" },
      { symbol: "FSR.JO", name: "FirstRand" },
      { symbol: "SBK.JO", name: "Standard Bank Group" },
      { symbol: "CPI.JO", name: "Capitec Bank" },
      { symbol: "MTN.JO", name: "MTN Group" },
      { symbol: "VOD.JO", name: "Vodacom Group" },
      { symbol: "SHP.JO", name: "Shoprite Holdings" },
      { symbol: "SOL.JO", name: "Sasol" },
      { symbol: "ANG.JO", name: "AngloGold Ashanti" },
      { symbol: "GFI.JO", name: "Gold Fields" },
      { symbol: "BTI.JO", name: "British American Tobacco" },
      { symbol: "GLN.JO", name: "Glencore" },
      { symbol: "ANH.JO", name: "Anheuser-Busch InBev" },
      { symbol: "BID.JO", name: "Bidcorp" },
      { symbol: "NED.JO", name: "Nedbank Group" },
      { symbol: "DSY.JO", name: "Discovery" },
    ],
  },
  {
    id: "egypt",
    name: "Egypt",
    region: "Africa",
    exchange: "Egyptian Exchange",
    instruments: [
      { symbol: "COMI.CA", name: "Commercial International Bank Egypt" },
      { symbol: "EAST.CA", name: "Eastern Company" },
      { symbol: "SWDY.CA", name: "Elsewedy Electric" },
      { symbol: "FWRY.CA", name: "Fawry" },
      { symbol: "TMGH.CA", name: "Talaat Moustafa Group" },
      { symbol: "ABUK.CA", name: "Abu Qir Fertilizers" },
      { symbol: "MFPC.CA", name: "Misr Fertilizers Production" },
      { symbol: "ORAS.CA", name: "Orascom Construction" },
      { symbol: "ETEL.CA", name: "Telecom Egypt" },
      { symbol: "PHDC.CA", name: "Palm Hills Developments" },
      { symbol: "JUFO.CA", name: "Juhayna Food Industries" },
      { symbol: "AMOC.CA", name: "Alexandria Mineral Oils" },
      { symbol: "OCDI.CA", name: "Sixth of October Development" },
      { symbol: "EKHO.CA", name: "Egypt Kuwait Holding" },
      { symbol: "SUGR.CA", name: "Delta Sugar" },
      { symbol: "SKPC.CA", name: "Sidi Kerir Petrochemicals" },
      { symbol: "ISPH.CA", name: "Ibnsina Pharma" },
      { symbol: "HELI.CA", name: "Heliopolis Housing" },
    ],
  },
  {
    id: "united-kingdom",
    name: "United Kingdom",
    region: "Europe",
    exchange: "London Stock Exchange",
    instruments: [
      { symbol: "AZN.L", name: "AstraZeneca" },
      { symbol: "SHEL.L", name: "Shell" },
      { symbol: "HSBA.L", name: "HSBC Holdings" },
      { symbol: "ULVR.L", name: "Unilever" },
      { symbol: "BP.L", name: "BP" },
      { symbol: "GSK.L", name: "GSK" },
      { symbol: "RIO.L", name: "Rio Tinto" },
      { symbol: "REL.L", name: "RELX" },
      { symbol: "LSEG.L", name: "London Stock Exchange Group" },
      { symbol: "NG.L", name: "National Grid" },
      { symbol: "BATS.L", name: "British American Tobacco" },
      { symbol: "DGE.L", name: "Diageo" },
      { symbol: "RR.L", name: "Rolls-Royce Holdings" },
      { symbol: "BA.L", name: "BAE Systems" },
      { symbol: "LLOY.L", name: "Lloyds Banking Group" },
      { symbol: "VOD.L", name: "Vodafone Group" },
      { symbol: "PRU.L", name: "Prudential" },
      { symbol: "AAL.L", name: "Anglo American" },
    ],
  },
  {
    id: "germany",
    name: "Germany",
    region: "Europe",
    exchange: "Xetra",
    instruments: [
      { symbol: "SAP.DE", name: "SAP" },
      { symbol: "SIE.DE", name: "Siemens" },
      { symbol: "ALV.DE", name: "Allianz" },
      { symbol: "DTE.DE", name: "Deutsche Telekom" },
      { symbol: "AIR.DE", name: "Airbus" },
      { symbol: "MBG.DE", name: "Mercedes-Benz Group" },
      { symbol: "BMW.DE", name: "BMW" },
      { symbol: "BAS.DE", name: "BASF" },
      { symbol: "MUV2.DE", name: "Munich Re" },
      { symbol: "DB1.DE", name: "Deutsche Börse" },
      { symbol: "IFX.DE", name: "Infineon Technologies" },
      { symbol: "RWE.DE", name: "RWE" },
      { symbol: "VOW3.DE", name: "Volkswagen" },
      { symbol: "ADS.DE", name: "Adidas" },
      { symbol: "HEN3.DE", name: "Henkel" },
      { symbol: "BAYN.DE", name: "Bayer" },
      { symbol: "DHL.DE", name: "DHL Group" },
      { symbol: "BEI.DE", name: "Beiersdorf" },
    ],
  },
  {
    id: "france",
    name: "France",
    region: "Europe",
    exchange: "Euronext Paris",
    instruments: [
      { symbol: "MC.PA", name: "LVMH" },
      { symbol: "OR.PA", name: "L'Oréal" },
      { symbol: "RMS.PA", name: "Hermès International" },
      { symbol: "TTE.PA", name: "TotalEnergies" },
      { symbol: "SAN.PA", name: "Sanofi" },
      { symbol: "AIR.PA", name: "Airbus" },
      { symbol: "SU.PA", name: "Schneider Electric" },
      { symbol: "BNP.PA", name: "BNP Paribas" },
      { symbol: "AI.PA", name: "Air Liquide" },
      { symbol: "EL.PA", name: "EssilorLuxottica" },
      { symbol: "CS.PA", name: "AXA" },
      { symbol: "DG.PA", name: "Vinci" },
      { symbol: "SAF.PA", name: "Safran" },
      { symbol: "KER.PA", name: "Kering" },
      { symbol: "RI.PA", name: "Pernod Ricard" },
      { symbol: "VIE.PA", name: "Veolia" },
      { symbol: "CAP.PA", name: "Capgemini" },
      { symbol: "SGO.PA", name: "Saint-Gobain" },
    ],
  },
  {
    id: "switzerland",
    name: "Switzerland",
    region: "Europe",
    exchange: "SIX Swiss Exchange",
    instruments: [
      { symbol: "NESN.SW", name: "Nestlé" },
      { symbol: "ROG.SW", name: "Roche" },
      { symbol: "NOVN.SW", name: "Novartis" },
      { symbol: "UBSG.SW", name: "UBS Group" },
      { symbol: "ABBN.SW", name: "ABB" },
      { symbol: "CFR.SW", name: "Richemont" },
      { symbol: "ZURN.SW", name: "Zurich Insurance" },
      { symbol: "SREN.SW", name: "Swiss Re" },
      { symbol: "GIVN.SW", name: "Givaudan" },
      { symbol: "LONN.SW", name: "Lonza Group" },
      { symbol: "HOLN.SW", name: "Holcim" },
      { symbol: "SIKA.SW", name: "Sika" },
      { symbol: "PGHN.SW", name: "Partners Group" },
      { symbol: "SGSN.SW", name: "SGS" },
      { symbol: "SCMN.SW", name: "Swisscom" },
      { symbol: "SLHN.SW", name: "Swiss Life" },
      { symbol: "BAER.SW", name: "Julius Baer" },
      { symbol: "LOGN.SW", name: "Logitech" },
    ],
  },
  {
    id: "india",
    name: "India",
    region: "Asia",
    exchange: "National Stock Exchange of India",
    instruments: [
      { symbol: "RELIANCE.NS", name: "Reliance Industries" },
      { symbol: "TCS.NS", name: "Tata Consultancy Services" },
      { symbol: "HDFCBANK.NS", name: "HDFC Bank" },
      { symbol: "BHARTIARTL.NS", name: "Bharti Airtel" },
      { symbol: "ICICIBANK.NS", name: "ICICI Bank" },
      { symbol: "INFY.NS", name: "Infosys" },
      { symbol: "SBIN.NS", name: "State Bank of India" },
      { symbol: "LICI.NS", name: "Life Insurance Corporation of India" },
      { symbol: "HINDUNILVR.NS", name: "Hindustan Unilever" },
      { symbol: "ITC.NS", name: "ITC" },
      { symbol: "LT.NS", name: "Larsen & Toubro" },
      { symbol: "BAJFINANCE.NS", name: "Bajaj Finance" },
      { symbol: "MARUTI.NS", name: "Maruti Suzuki India" },
      { symbol: "SUNPHARMA.NS", name: "Sun Pharmaceutical" },
      { symbol: "KOTAKBANK.NS", name: "Kotak Mahindra Bank" },
      { symbol: "M&M.NS", name: "Mahindra & Mahindra" },
      { symbol: "AXISBANK.NS", name: "Axis Bank" },
      { symbol: "NTPC.NS", name: "NTPC" },
    ],
  },
  {
    id: "japan",
    name: "Japan",
    region: "Asia",
    exchange: "Tokyo Stock Exchange",
    instruments: [
      { symbol: "7203.T", name: "Toyota Motor" },
      { symbol: "6758.T", name: "Sony Group" },
      { symbol: "8306.T", name: "Mitsubishi UFJ Financial" },
      { symbol: "9984.T", name: "SoftBank Group" },
      { symbol: "6861.T", name: "Keyence" },
      { symbol: "6501.T", name: "Hitachi" },
      { symbol: "8035.T", name: "Tokyo Electron" },
      { symbol: "8058.T", name: "Mitsubishi Corporation" },
      { symbol: "4063.T", name: "Shin-Etsu Chemical" },
      { symbol: "6098.T", name: "Recruit Holdings" },
      { symbol: "9432.T", name: "NTT" },
      { symbol: "9983.T", name: "Fast Retailing" },
      { symbol: "9433.T", name: "KDDI" },
      { symbol: "7267.T", name: "Honda Motor" },
      { symbol: "6902.T", name: "Denso" },
      { symbol: "8001.T", name: "Itochu" },
      { symbol: "4502.T", name: "Takeda Pharmaceutical" },
      { symbol: "2914.T", name: "Japan Tobacco" },
    ],
  },
  {
    id: "hong-kong",
    name: "Hong Kong",
    region: "Asia",
    exchange: "Hong Kong Stock Exchange",
    instruments: [
      { symbol: "0700.HK", name: "Tencent Holdings" },
      { symbol: "9988.HK", name: "Alibaba Group" },
      { symbol: "0005.HK", name: "HSBC Holdings" },
      { symbol: "0941.HK", name: "China Mobile" },
      { symbol: "1299.HK", name: "AIA Group" },
      { symbol: "3690.HK", name: "Meituan" },
      { symbol: "2318.HK", name: "Ping An Insurance" },
      { symbol: "0883.HK", name: "CNOOC" },
      { symbol: "1810.HK", name: "Xiaomi" },
      { symbol: "0388.HK", name: "Hong Kong Exchanges and Clearing" },
      { symbol: "1211.HK", name: "BYD" },
      { symbol: "9999.HK", name: "NetEase" },
      { symbol: "1398.HK", name: "Industrial and Commercial Bank of China" },
      { symbol: "0939.HK", name: "China Construction Bank" },
      { symbol: "3988.HK", name: "Bank of China" },
      { symbol: "2628.HK", name: "China Life Insurance" },
      { symbol: "9618.HK", name: "JD.com" },
      { symbol: "1024.HK", name: "Kuaishou Technology" },
    ],
  },
  {
    id: "south-korea",
    name: "South Korea",
    region: "Asia",
    exchange: "Korea Exchange",
    instruments: [
      { symbol: "005930.KS", name: "Samsung Electronics" },
      { symbol: "000660.KS", name: "SK hynix" },
      { symbol: "373220.KS", name: "LG Energy Solution" },
      { symbol: "207940.KS", name: "Samsung Biologics" },
      { symbol: "005380.KS", name: "Hyundai Motor" },
      { symbol: "005490.KS", name: "POSCO Holdings" },
      { symbol: "035420.KS", name: "NAVER" },
      { symbol: "035720.KS", name: "Kakao" },
      { symbol: "051910.KS", name: "LG Chem" },
      { symbol: "006400.KS", name: "Samsung SDI" },
      { symbol: "105560.KS", name: "KB Financial Group" },
      { symbol: "055550.KS", name: "Shinhan Financial Group" },
      { symbol: "068270.KS", name: "Celltrion" },
      { symbol: "028260.KS", name: "Samsung C&T" },
      { symbol: "012330.KS", name: "Hyundai Mobis" },
      { symbol: "066570.KS", name: "LG Electronics" },
      { symbol: "003670.KS", name: "POSCO Future M" },
      { symbol: "096770.KS", name: "SK Innovation" },
    ],
  },
  {
    id: "australia",
    name: "Australia",
    region: "Asia-Pacific",
    exchange: "Australian Securities Exchange",
    instruments: [
      { symbol: "BHP.AX", name: "BHP Group" },
      { symbol: "CBA.AX", name: "Commonwealth Bank" },
      { symbol: "CSL.AX", name: "CSL" },
      { symbol: "NAB.AX", name: "National Australia Bank" },
      { symbol: "WBC.AX", name: "Westpac Banking" },
      { symbol: "ANZ.AX", name: "ANZ Group" },
      { symbol: "WES.AX", name: "Wesfarmers" },
      { symbol: "MQG.AX", name: "Macquarie Group" },
      { symbol: "GMG.AX", name: "Goodman Group" },
      { symbol: "TLS.AX", name: "Telstra Group" },
      { symbol: "RIO.AX", name: "Rio Tinto" },
      { symbol: "WOW.AX", name: "Woolworths Group" },
      { symbol: "WDS.AX", name: "Woodside Energy" },
      { symbol: "TCL.AX", name: "Transurban Group" },
      { symbol: "ALL.AX", name: "Aristocrat Leisure" },
      { symbol: "REA.AX", name: "REA Group" },
      { symbol: "QBE.AX", name: "QBE Insurance" },
      { symbol: "FMG.AX", name: "Fortescue" },
    ],
  },
  {
    id: "canada",
    name: "Canada",
    region: "North America",
    exchange: "Toronto Stock Exchange",
    instruments: [
      { symbol: "RY.TO", name: "Royal Bank of Canada" },
      { symbol: "TD.TO", name: "Toronto-Dominion Bank" },
      { symbol: "SHOP.TO", name: "Shopify" },
      { symbol: "ENB.TO", name: "Enbridge" },
      { symbol: "CNR.TO", name: "Canadian National Railway" },
      { symbol: "CP.TO", name: "Canadian Pacific Kansas City" },
      { symbol: "BMO.TO", name: "Bank of Montreal" },
      { symbol: "BNS.TO", name: "Bank of Nova Scotia" },
      { symbol: "CNQ.TO", name: "Canadian Natural Resources" },
      { symbol: "SU.TO", name: "Suncor Energy" },
      { symbol: "BAM.TO", name: "Brookfield Asset Management" },
      { symbol: "TRI.TO", name: "Thomson Reuters" },
      { symbol: "BCE.TO", name: "BCE" },
      { symbol: "MFC.TO", name: "Manulife Financial" },
      { symbol: "SLF.TO", name: "Sun Life Financial" },
      { symbol: "ATD.TO", name: "Alimentation Couche-Tard" },
      { symbol: "NTR.TO", name: "Nutrien" },
      { symbol: "WCN.TO", name: "Waste Connections" },
    ],
  },
  {
    id: "brazil",
    name: "Brazil",
    region: "South America",
    exchange: "B3",
    instruments: [
      { symbol: "PETR4.SA", name: "Petrobras" },
      { symbol: "VALE3.SA", name: "Vale" },
      { symbol: "ITUB4.SA", name: "Itaú Unibanco" },
      { symbol: "BBDC4.SA", name: "Banco Bradesco" },
      { symbol: "BBAS3.SA", name: "Banco do Brasil" },
      { symbol: "ABEV3.SA", name: "Ambev" },
      { symbol: "WEGE3.SA", name: "WEG" },
      { symbol: "ELET3.SA", name: "Eletrobras" },
      { symbol: "B3SA3.SA", name: "B3" },
      { symbol: "SUZB3.SA", name: "Suzano" },
      { symbol: "RENT3.SA", name: "Localiza" },
      { symbol: "JBSS3.SA", name: "JBS" },
      { symbol: "BPAC11.SA", name: "BTG Pactual" },
      { symbol: "VIVT3.SA", name: "Telefônica Brasil" },
      { symbol: "PRIO3.SA", name: "PRIO" },
      { symbol: "RAIL3.SA", name: "Rumo" },
      { symbol: "RADL3.SA", name: "Raia Drogasil" },
      { symbol: "HAPV3.SA", name: "Hapvida" },
    ],
  },
  {
    id: "mexico",
    name: "Mexico",
    region: "North America",
    exchange: "Mexican Stock Exchange",
    instruments: [
      { symbol: "WALMEX.MX", name: "Walmart de México" },
      { symbol: "AMXL.MX", name: "América Móvil" },
      { symbol: "FEMSAUBD.MX", name: "FEMSA" },
      { symbol: "GFNORTEO.MX", name: "Grupo Financiero Banorte" },
      { symbol: "GMEXICOB.MX", name: "Grupo México" },
      { symbol: "BIMBOA.MX", name: "Grupo Bimbo" },
      { symbol: "CEMEXCPO.MX", name: "Cemex" },
      { symbol: "GAPB.MX", name: "Grupo Aeroportuario del Pacífico" },
      { symbol: "ASURB.MX", name: "Grupo Aeroportuario del Sureste" },
      { symbol: "KIMBERA.MX", name: "Kimberly-Clark de México" },
      { symbol: "AC.MX", name: "Arca Continental" },
      { symbol: "ORBIA.MX", name: "Orbia" },
      { symbol: "TLEVISACPO.MX", name: "Grupo Televisa" },
      { symbol: "ELEKTRA.MX", name: "Grupo Elektra" },
      { symbol: "PINFRA.MX", name: "Promotora y Operadora de Infraestructura" },
      { symbol: "GFINBURO.MX", name: "Grupo Financiero Inbursa" },
      { symbol: "ALFAA.MX", name: "Alfa" },
      { symbol: "LIVEPOLC-1.MX", name: "El Puerto de Liverpool" },
    ],
  },
  {
    id: "saudi-arabia",
    name: "Saudi Arabia",
    region: "Middle East",
    exchange: "Saudi Exchange",
    instruments: [
      { symbol: "2222.SR", name: "Saudi Aramco" },
      { symbol: "1120.SR", name: "Al Rajhi Bank" },
      { symbol: "2010.SR", name: "SABIC" },
      { symbol: "1180.SR", name: "Saudi National Bank" },
      { symbol: "7010.SR", name: "stc" },
      { symbol: "1211.SR", name: "Ma'aden" },
      { symbol: "2082.SR", name: "ACWA Power" },
      { symbol: "7203.SR", name: "Elm" },
      { symbol: "2280.SR", name: "Almarai" },
      { symbol: "1150.SR", name: "Alinma Bank" },
      { symbol: "1010.SR", name: "Riyad Bank" },
      { symbol: "2020.SR", name: "SABIC Agri-Nutrients" },
      { symbol: "1060.SR", name: "Saudi Awwal Bank" },
      { symbol: "1050.SR", name: "Banque Saudi Fransi" },
      { symbol: "1140.SR", name: "Bank Albilad" },
      { symbol: "4003.SR", name: "eXtra" },
      { symbol: "4001.SR", name: "Abdullah Al Othaim Markets" },
      { symbol: "4030.SR", name: "Bahri" },
    ],
  },
  {
    id: "singapore",
    name: "Singapore",
    region: "Asia-Pacific",
    exchange: "Singapore Exchange",
    instruments: [
      { symbol: "D05.SI", name: "DBS Group" },
      { symbol: "O39.SI", name: "OCBC" },
      { symbol: "U11.SI", name: "United Overseas Bank" },
      { symbol: "Z74.SI", name: "Singtel" },
      { symbol: "C6L.SI", name: "Singapore Airlines" },
      { symbol: "A17U.SI", name: "CapitaLand Ascendas REIT" },
      { symbol: "C38U.SI", name: "CapitaLand Integrated Commercial Trust" },
      { symbol: "BN4.SI", name: "Keppel" },
      { symbol: "S68.SI", name: "Singapore Exchange" },
      { symbol: "F34.SI", name: "Wilmar International" },
      { symbol: "U96.SI", name: "Sembcorp Industries" },
      { symbol: "H78.SI", name: "Hongkong Land" },
      { symbol: "C09.SI", name: "City Developments" },
      { symbol: "S63.SI", name: "ST Engineering" },
      { symbol: "BS6.SI", name: "Yangzijiang Shipbuilding" },
      { symbol: "Y92.SI", name: "Thai Beverage" },
      { symbol: "M44U.SI", name: "Mapletree Logistics Trust" },
      { symbol: "N2IU.SI", name: "Mapletree Pan Asia Commercial Trust" },
    ],
  },
];

const ALL_GLOBAL_STOCK_MARKETS: GlobalStockMarket[] = MARKET_DIRECTORY_CATALOG.map((country) => {
  const curatedMarket = GLOBAL_STOCK_MARKETS.find((market) => market.id === country.id);
  return {
    id: country.id,
    name: country.name,
    region: country.region,
    exchange: country.exchange,
    instruments: curatedMarket?.instruments || [],
  };
});

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  return `$${(value / 1_000_000).toFixed(1)}M`;
}

function formatBoardPrice(value: number) {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1_000 ? 2 : magnitude >= 10 ? 3 : magnitude >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  });
}

function CategoryBoard({
  category,
  boardConfig,
  onSelectStock,
}: {
  category: Exclude<MarketCategory, "stocks">;
  boardConfig?: QuoteBoardConfig;
  onSelectStock: (symbol: string) => void;
}) {
  const config = boardConfig || CATEGORY_BOARDS[category as StandardBoardCategory];
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CategoryQuoteSort>("default");
  const [descending, setDescending] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshInFlightRef = useRef(false);

  const loadQuotes = useCallback(async (quiet = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const symbols = config.instruments.map((instrument) => instrument.symbol).join(",");
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Category quotes unavailable");
      const payload = await response.json() as { quotes?: Quote[] };
      const bySymbol = new Map((payload.quotes || []).map((quote) => [quote.symbol, quote]));
      const nextQuotes = config.instruments.flatMap((instrument) => {
        const quote = bySymbol.get(instrument.symbol);
        return quote ? [{ ...quote, name: instrument.name }] : [];
      });
      if (!nextQuotes.length) throw new Error("No category quotes returned");
      setQuotes(nextQuotes);
      setLastUpdated(new Date());
      setError(null);
    } catch {
      setError(`Live ${config.title.toLowerCase()} data is temporarily unavailable.`);
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [config]);

  useEffect(() => {
    void loadQuotes();
    const refresh = window.setInterval(() => void loadQuotes(true), 1_000);
    return () => window.clearInterval(refresh);
  }, [loadQuotes]);

  const visibleQuotes = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();
    const filtered = quotes.filter((quote) => (
      !normalizedSearch
      || quote.symbol.toUpperCase().includes(normalizedSearch)
      || quote.name.toUpperCase().includes(normalizedSearch)
      || quote.exchange.toUpperCase().includes(normalizedSearch)
    ));
    const position = new Map(config.instruments.map((instrument, index) => [instrument.symbol, index]));
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sort === "default") comparison = (position.get(a.symbol) || 0) - (position.get(b.symbol) || 0);
      else if (sort === "name") comparison = a.name.localeCompare(b.name);
      else comparison = a[sort] - b[sort];
      return sort !== "default" && descending ? -comparison : comparison;
    });
  }, [config, descending, quotes, search, sort]);

  const movers = useMemo(
    () => [...quotes].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 3),
    [quotes],
  );
  const advancers = quotes.filter((quote) => quote.changePercent >= 0).length;
  const activeMarkets = new Set(quotes.map((quote) => quote.exchange)).size;
  const leader = movers[0];

  function chooseSort(nextSort: CategoryQuoteSort) {
    if (sort === nextSort && nextSort !== "default") {
      setDescending((current) => !current);
      return;
    }
    setSort(nextSort);
    setDescending(nextSort !== "name" && nextSort !== "default");
  }

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <section className={`category-page category-${category}`}>
      <div className="category-hero">
        <div>
          <span className="eyebrow">{config.eyebrow}</span>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <div className="mega-hero-status">
          <span className={error && !quotes.length ? "offline" : ""} />
          <div>
            <strong>{refreshing ? "REFRESHING" : quotes.length ? `${quotes.length} LIVE INSTRUMENTS` : "CONNECTING"}</strong>
            <small>Updated {updatedLabel} · checks every 1s</small>
          </div>
        </div>
      </div>

      {error && (
        <div className="mega-error" role="status">
          <span>{error}</span>
          {!!quotes.length && <small>Keeping the last verified prices on screen.</small>}
          <button type="button" onClick={() => void loadQuotes()}>Retry</button>
        </div>
      )}

      {loading && !quotes.length ? (
        <div className="mega-loading panel">
          <span />
          <strong>Connecting to {config.title.toLowerCase()}…</strong>
          <small>Loading verified quotes from Yahoo Finance.</small>
        </div>
      ) : quotes.length ? (
        <>
          <div className="mega-summary">
            <div>
              <span>INSTRUMENTS LIVE</span>
              <strong>{quotes.length}<i> / {config.instruments.length}</i></strong>
              <small>Verified quotes returned</small>
            </div>
            <div>
              <span>ADVANCERS</span>
              <strong>{advancers}<i> / {quotes.length}</i></strong>
              <small>Non-negative today</small>
            </div>
            <div>
              <span>LARGEST MOVE</span>
              <strong>{leader?.symbol || "—"}</strong>
              <small>{leader ? `${leader.changePercent >= 0 ? "+" : ""}${leader.changePercent.toFixed(2)}%` : "—"}</small>
            </div>
            <div>
              <span>MARKET VENUES</span>
              <strong>{activeMarkets}</strong>
              <small>Sources represented</small>
            </div>
          </div>

          <div className="mega-podium category-movers" aria-label={`Largest ${config.title.toLowerCase()} moves`}>
            {movers.map((quote, index) => (
              <button
                type="button"
                className={`mega-leader rank-${index + 1}`}
                key={quote.symbol}
                onClick={() => onSelectStock(quote.symbol)}
              >
                <span className="mega-rank">0{index + 1}</span>
                <div>
                  <small>{quote.name}</small>
                  <strong>{quote.symbol}</strong>
                </div>
                <div className="mega-leader-value">
                  <strong>{formatBoardPrice(quote.price)} {quote.currency}</strong>
                  <span className={quote.changePercent >= 0 ? "up-text" : "down-text"}>
                    {quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%
                  </span>
                </div>
              </button>
            ))}
          </div>

          <section className="mega-table-card panel">
            <div className="mega-toolbar">
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${config.title.toLowerCase()}`}
                  aria-label={`Search ${config.title} instruments`}
                />
              </label>
              <div className="mega-sort" aria-label={`Sort ${config.title}`}>
                <span>SORT</span>
                {([
                  ["default", "Board order"],
                  ["changePercent", "Daily move"],
                  ["price", "Price"],
                  ["name", "Name"],
                ] as Array<[CategoryQuoteSort, string]>).map(([value, label]) => (
                  <button
                    type="button"
                    className={sort === value ? "active" : ""}
                    key={value}
                    onClick={() => chooseSort(value)}
                  >
                    {label}{sort === value && value !== "default" ? (descending ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </div>
              <button
                className="mega-refresh"
                type="button"
                onClick={() => void loadQuotes(true)}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
            </div>

            <div className="mega-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Instrument</th>
                    <th>Venue</th>
                    <th>Last price</th>
                    <th>Daily move</th>
                    <th>Previous close</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuotes.map((quote) => {
                    const boardIndex = config.instruments.findIndex((instrument) => instrument.symbol === quote.symbol);
                    return (
                      <tr key={quote.symbol}>
                        <td><span className="mega-table-rank">{String(boardIndex + 1).padStart(2, "0")}</span></td>
                        <td>
                          <button
                            type="button"
                            className="mega-company"
                            onClick={() => onSelectStock(quote.symbol)}
                          >
                            <span>{quote.symbol.replace(/[^A-Z0-9]/g, "").slice(0, 1)}</span>
                            <div>
                              <strong>{quote.symbol}</strong>
                              <small>{quote.name}</small>
                            </div>
                          </button>
                        </td>
                        <td><span className="mega-exchange">{quote.exchange}</span></td>
                        <td><strong>{formatBoardPrice(quote.price)}</strong> <small>{quote.currency}</small></td>
                        <td>
                          <span className={quote.changePercent >= 0 ? "mega-move up" : "mega-move down"}>
                            {quote.changePercent >= 0 ? "↗ +" : "↘ "}{quote.changePercent.toFixed(2)}%
                          </span>
                        </td>
                        <td>{formatBoardPrice(quote.previousClose)}</td>
                        <td>
                          <button
                            type="button"
                            className="mega-open"
                            onClick={() => onSelectStock(quote.symbol)}
                            aria-label={`Open ${quote.symbol} in market dashboard`}
                          >
                            View ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visibleQuotes.length && (
                <div className="mega-empty">
                  No {config.title.toLowerCase()} instruments match “{search}”.
                </div>
              )}
            </div>
          </section>

          <p className="mega-footnote">
            Prices come from Yahoo Finance and may be delayed. Futures, currencies, crypto, and indices
            can trade on different schedules; closed markets retain their latest verified quote.
          </p>
        </>
      ) : null}
    </section>
  );
}

function DirectorySparkline({
  symbol,
  points,
}: {
  symbol: string;
  points: SparklinePoint[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positive = points[points.length - 1].value >= points[0].value;
  const firstPrice = points[0].value;
  const lastPrice = points[points.length - 1].value;
  const monthlyMove = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = 142;
    const height = 44;
    const ratio = 2;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const values = points.map((point) => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const spread = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.002, 0.0001);
    const min = rawMin - spread * 0.12;
    const max = rawMax + spread * 0.12;
    const x = (index: number) => 2 + (index / (points.length - 1)) * (width - 4);
    const y = (value: number) => 3 + ((max - value) / (max - min)) * (height - 8);
    const color = positive ? "#6f9f08" : "#d94c43";

    context.strokeStyle = "rgba(29, 32, 27, 0.08)";
    context.lineWidth = 1;
    [0.25, 0.75].forEach((fraction) => {
      const lineY = height * fraction;
      context.beginPath();
      context.moveTo(0, lineY + 0.5);
      context.lineTo(width, lineY + 0.5);
      context.stroke();
    });

    const fill = context.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, positive ? "rgba(173, 255, 47, 0.22)" : "rgba(255, 105, 94, 0.18)");
    fill.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(x(index), y(point.value));
      else context.lineTo(x(index), y(point.value));
    });
    context.lineTo(x(points.length - 1), height);
    context.lineTo(x(0), height);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(x(index), y(point.value));
      else context.lineTo(x(index), y(point.value));
    });
    context.strokeStyle = color;
    context.lineWidth = 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    context.beginPath();
    context.arc(x(points.length - 1), y(lastPrice), 2.7, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }, [lastPrice, points, positive]);

  return (
    <div
      className={`directory-chart ${positive ? "positive" : "negative"}`}
      title={`${symbol} one-month move: ${monthlyMove >= 0 ? "+" : ""}${monthlyMove.toFixed(2)}%`}
    >
      <canvas
        ref={canvasRef}
        aria-label={`${symbol} one-month price chart, ${monthlyMove >= 0 ? "up" : "down"} ${Math.abs(monthlyMove).toFixed(2)} percent`}
      />
      <small>{monthlyMove >= 0 ? "+" : ""}{monthlyMove.toFixed(1)}%</small>
    </div>
  );
}

function GlobalDirectoryBoard({
  market,
  onSelectStock,
}: {
  market: GlobalStockMarket;
  onSelectStock: (symbol: string) => void;
}) {
  const [payload, setPayload] = useState<MarketDirectoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MegaCapSort>("name");
  const [descending, setDescending] = useState(false);
  const [sparklines, setSparklines] = useState<Record<string, SparklinePoint[]>>({});
  const [chartStates, setChartStates] = useState<Record<string, "loading" | "ready" | "unavailable">>({});
  const requestInFlightRef = useRef(false);
  const requestedChartsRef = useRef(new Set<string>());

  const loadDirectoryPage = useCallback(async (offset = 0, append = false) => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const response = await fetch(
        `/api/market-directory?market=${encodeURIComponent(market.id)}&offset=${offset}&limit=250`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Market directory unavailable");
      const nextPayload = await response.json() as MarketDirectoryPayload;
      if (!Array.isArray(nextPayload.listings)) throw new Error("Invalid market directory");
      setPayload((current) => {
        if (!append || !current || current.marketId !== nextPayload.marketId) return nextPayload;
        const merged = [...current.listings, ...nextPayload.listings]
          .filter((listing, index, listings) => (
            listings.findIndex((candidate) => candidate.symbol === listing.symbol) === index
          ));
        return {
          ...nextPayload,
          count: merged.length,
          listings: merged,
        };
      });
      setError(null);
    } catch {
      setError(`The complete ${market.name} directory is temporarily unavailable.`);
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [market.id, market.name]);

  useEffect(() => {
    setPayload(null);
    setSearch("");
    setError(null);
    void loadDirectoryPage();
  }, [loadDirectoryPage]);

  useEffect(() => {
    const missingSymbols = (payload?.listings || [])
      .map((stock) => stock.symbol)
      .filter((symbol) => !requestedChartsRef.current.has(symbol));
    if (!missingSymbols.length) return;

    missingSymbols.forEach((symbol) => requestedChartsRef.current.add(symbol));
    setChartStates((current) => {
      const next = { ...current };
      missingSymbols.forEach((symbol) => {
        next[symbol] = "loading";
      });
      return next;
    });

    const controller = new AbortController();
    let completed = false;
    const batches: string[][] = [];
    for (let index = 0; index < missingSymbols.length; index += 50) {
      batches.push(missingSymbols.slice(index, index + 50));
    }

    async function fetchBatch(batch: string[]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(
            `/api/sparklines?symbols=${encodeURIComponent(batch.join(","))}`,
            { cache: "force-cache", signal: controller.signal },
          );
          if (!response.ok) throw new Error("Sparkline batch unavailable");
          const batchPayload = await response.json() as SparklinePayload;
          return Array.isArray(batchPayload.charts) ? batchPayload.charts : [];
        } catch (requestError) {
          if (controller.signal.aborted) return [];
          if (attempt === 1) return [];
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        }
      }
      return [];
    }

    async function loadSparklines() {
      const results = await Promise.all(batches.map(fetchBatch));
      if (controller.signal.aborted) return;

      const charts = results.flat();
      const readySymbols = new Set(charts.map((chart) => chart.symbol));
      setSparklines((current) => {
        const next = { ...current };
        charts.forEach((chart) => {
          next[chart.symbol] = chart.points;
        });
        return next;
      });
      setChartStates((current) => {
        const next = { ...current };
        missingSymbols.forEach((symbol) => {
          next[symbol] = readySymbols.has(symbol) ? "ready" : "unavailable";
        });
        return next;
      });
      completed = true;
    }

    void loadSparklines();
    return () => {
      controller.abort();
      if (!completed) {
        missingSymbols.forEach((symbol) => requestedChartsRef.current.delete(symbol));
      }
    };
  }, [payload?.listings]);

  const visibleListings = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();
    const filtered = (payload?.listings || []).filter((stock) => (
      !normalizedSearch
      || stock.symbol.toUpperCase().includes(normalizedSearch)
      || stock.name.toUpperCase().includes(normalizedSearch)
      || stock.exchange.toUpperCase().includes(normalizedSearch)
    ));
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sort === "name") comparison = a.name.localeCompare(b.name);
      else comparison = a[sort] - b[sort];
      return descending ? -comparison : comparison;
    });
  }, [descending, payload, search, sort]);

  const topThree = useMemo(
    () => [...(payload?.listings || [])]
      .filter((stock) => stock.marketCap > 0)
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 3),
    [payload],
  );
  const advancers = (payload?.listings || []).filter((stock) => stock.changePercent >= 0).length;
  const chartReadyCount = (payload?.listings || [])
    .filter((stock) => chartStates[stock.symbol] === "ready").length;
  const nextOffset = payload ? payload.offset + payload.providerCount : 0;
  const hasMore = Boolean(payload && nextOffset < payload.total);

  function chooseSort(nextSort: MegaCapSort) {
    if (sort === nextSort) {
      setDescending((current) => !current);
      return;
    }
    setSort(nextSort);
    setDescending(nextSort !== "name");
  }

  const updatedLabel = payload
    ? new Date(payload.fetchedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <section className="category-page category-global">
      <div className="category-hero">
        <div>
          <span className="eyebrow">{market.region.toUpperCase()} COMPLETE EQUITY DIRECTORY</span>
          <h1>{market.name}</h1>
          <p>
            Every provider-classified equity listing in {market.name}, loaded alphabetically in pages of 250.
            Select any row to open its live chart and probability tools.
          </p>
        </div>
        <div className="mega-hero-status">
          <span className={error && !payload ? "offline" : ""} />
          <div>
            <strong>
              {loadingMore
                ? "LOADING NEXT 250"
                : payload
                  ? `${payload.listings.length.toLocaleString()} OF ${payload.total.toLocaleString()} LOADED`
                  : "CONNECTING"}
            </strong>
            <small>
              Updated {updatedLabel} · {chartReadyCount.toLocaleString()} one-month charts ready
            </small>
          </div>
        </div>
      </div>

      {error && (
        <div className="mega-error" role="status">
          <span>{error}</span>
          {payload && <small>Keeping the listings already loaded on screen.</small>}
          <button type="button" onClick={() => void loadDirectoryPage(payload ? nextOffset : 0, Boolean(payload))}>
            Retry
          </button>
        </div>
      )}

      {loading && !payload ? (
        <div className="mega-loading panel">
          <span />
          <strong>Opening the complete {market.name} directory…</strong>
          <small>Loading the first 250 equity listings from Yahoo Finance.</small>
        </div>
      ) : payload ? (
        <>
          <div className="mega-summary">
            <div>
              <span>TOTAL LISTINGS</span>
              <strong>{payload.total.toLocaleString()}</strong>
              <small>Provider-classified equities</small>
            </div>
            <div>
              <span>LOADED NOW</span>
              <strong>{payload.listings.length.toLocaleString()}</strong>
              <small>Searchable in this table</small>
            </div>
            <div>
              <span>ADVANCERS LOADED</span>
              <strong>{advancers}<i> / {payload.listings.length}</i></strong>
              <small>Non-negative latest move</small>
            </div>
            <div>
              <span>PRIMARY VENUE</span>
              <strong>{market.exchange}</strong>
              <small>{market.region}</small>
            </div>
          </div>

          {!!topThree.length && (
            <div className="mega-podium category-movers" aria-label={`Largest loaded ${market.name} listings`}>
              {topThree.map((stock, index) => (
                <button
                  type="button"
                  className={`mega-leader rank-${index + 1}`}
                  key={stock.symbol}
                  onClick={() => onSelectStock(stock.symbol)}
                >
                  <span className="mega-rank">0{index + 1}</span>
                  <div>
                    <small>{stock.name}</small>
                    <strong>{stock.symbol}</strong>
                  </div>
                  <div className="mega-leader-value">
                    <strong>{formatCompact(stock.marketCap)} {stock.currency}</strong>
                    <span className={stock.changePercent >= 0 ? "up-text" : "down-text"}>
                      {stock.changePercent >= 0 ? "+" : ""}{stock.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <section className="mega-table-card panel">
            <div className="mega-toolbar">
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search loaded ${market.name} listings`}
                  aria-label={`Search loaded ${market.name} listings`}
                />
              </label>
              <div className="mega-sort" aria-label={`Sort ${market.name} directory`}>
                <span>SORT</span>
                {([
                  ["name", "Company"],
                  ["marketCap", "Market cap"],
                  ["changePercent", "Daily move"],
                  ["price", "Price"],
                ] as Array<[MegaCapSort, string]>).map(([value, label]) => (
                  <button
                    type="button"
                    className={sort === value ? "active" : ""}
                    key={value}
                    onClick={() => chooseSort(value)}
                  >
                    {label}{sort === value ? (descending ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </div>
              <button
                className="mega-refresh"
                type="button"
                onClick={() => void loadDirectoryPage()}
                disabled={loading || loadingMore}
              >
                {loading ? "Refreshing…" : "Refresh first page"}
              </button>
            </div>

            <div className="mega-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Company</th>
                    <th>Venue</th>
                    <th>Last price</th>
                    <th>Daily move</th>
                    <th>1M chart</th>
                    <th>Market cap</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleListings.map((stock) => (
                    <tr key={stock.symbol}>
                      <td><span className="mega-table-rank">{stock.rank.toLocaleString()}</span></td>
                      <td>
                        <button
                          type="button"
                          className="mega-company"
                          onClick={() => onSelectStock(stock.symbol)}
                        >
                          <span>{stock.symbol.replace(/[^A-Z0-9]/g, "").slice(0, 1)}</span>
                          <div>
                            <strong>{stock.symbol}</strong>
                            <small>{stock.name}</small>
                          </div>
                        </button>
                      </td>
                      <td><span className="mega-exchange">{stock.exchange}</span></td>
                      <td><strong>{formatBoardPrice(stock.price)}</strong> <small>{stock.currency}</small></td>
                      <td>
                        <span className={stock.changePercent >= 0 ? "mega-move up" : "mega-move down"}>
                          {stock.changePercent >= 0 ? "↗ +" : "↘ "}{stock.changePercent.toFixed(2)}%
                        </span>
                      </td>
                      <td>
                        {sparklines[stock.symbol]?.length >= 2 ? (
                          <DirectorySparkline symbol={stock.symbol} points={sparklines[stock.symbol]} />
                        ) : chartStates[stock.symbol] === "unavailable" ? (
                          <span className="directory-chart-unavailable">No 1M data</span>
                        ) : (
                          <span className="directory-chart-loading" aria-label={`Loading ${stock.symbol} chart`}>
                            <i />
                            <i />
                            <i />
                          </span>
                        )}
                      </td>
                      <td>{stock.marketCap > 0 ? `${formatCompact(stock.marketCap)} ${stock.currency}` : "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="mega-open"
                          onClick={() => onSelectStock(stock.symbol)}
                          aria-label={`Open ${stock.symbol} in market dashboard`}
                        >
                          View ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleListings.length && (
                <div className="mega-empty">
                  {payload.total
                    ? `No loaded listings match “${search}”.`
                    : `Yahoo Finance returned no classified equity listings for ${market.name}.`}
                </div>
              )}
            </div>

            {hasMore && (
              <div className="directory-pagination">
                <div>
                  <strong>{payload.listings.length.toLocaleString()} loaded</strong>
                  <small>{(payload.total - nextOffset).toLocaleString()} provider listings remain after this page</small>
                </div>
                <button
                  type="button"
                  onClick={() => void loadDirectoryPage(nextOffset, true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load next 250"}
                </button>
              </div>
            )}
          </section>

          <p className="mega-footnote">
            The count comes from Yahoo Finance&apos;s regional equity classification and can include listed trusts,
            active ETFs, secondary listings, and companies without complete price fields. Pages are loaded on demand
            to keep the dashboard responsive.
          </p>
        </>
      ) : null}
    </section>
  );
}

function GlobalStocksPanel({
  onSelectStock,
}: {
  onSelectStock: (symbol: string) => void;
}) {
  const [marketId, setMarketId] = useState("south-africa");
  const market = ALL_GLOBAL_STOCK_MARKETS.find((item) => item.id === marketId) || ALL_GLOBAL_STOCK_MARKETS[0];
  const regions = [...new Set(ALL_GLOBAL_STOCK_MARKETS.map((item) => item.region))];

  return (
    <>
      <section className="global-market-picker panel">
        <div>
          <span className="eyebrow">GLOBAL EQUITY DIRECTORY</span>
          <strong>Choose a national market</strong>
          <small>
            Complete provider directories for {ALL_GLOBAL_STOCK_MARKETS.length} countries across {regions.length} regions,
            plus worldwide company-name search.
          </small>
        </div>
        <label>
          <span>MARKET</span>
          <select
            value={market.id}
            onChange={(event) => setMarketId(event.target.value)}
            aria-label="Choose a global stock market"
          >
            {regions.map((region) => (
              <optgroup label={region} key={region}>
                {ALL_GLOBAL_STOCK_MARKETS
                  .filter((item) => item.region === region)
                  .map((item) => (
                    <option value={item.id} key={item.id}>{item.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="global-market-venue">
          <span>{market.region}</span>
          <strong>{market.exchange}</strong>
          <small>Every provider-classified listing</small>
        </div>
        <div className="global-stock-search">
          <span>ALL STOCKS</span>
          <SearchableTickerSelect
            value=""
            options={market.instruments}
            onChange={onSelectStock}
            ariaLabel="Search every supported global stock"
            triggerLabel="Find any stock"
            triggerDescription="Search company or ticker"
          />
        </div>
      </section>
      <GlobalDirectoryBoard
        key={market.id}
        market={market}
        onSelectStock={onSelectStock}
      />
    </>
  );
}

function MarketExplorerPanel({
  onSelectStock,
}: {
  onSelectStock: (symbol: string) => void;
}) {
  const [category, setCategory] = useState<MarketCategory>("stocks");

  return (
    <div className="market-explorer">
      <div className="market-category-bar">
        <div>
          <span className="eyebrow">MARKET DIRECTORY</span>
          <strong>Switch asset class</strong>
        </div>
        <div className="market-category-tabs" aria-label="Choose market category">
          {MARKET_CATEGORY_OPTIONS.map((option) => (
            <button
              type="button"
              className={category === option.value ? "active" : ""}
              aria-pressed={category === option.value}
              key={option.value}
              onClick={() => setCategory(option.value)}
            >
              <span>{option.shortLabel}</span>
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
      </div>

      {category === "stocks" ? (
        <MegaCapPanel onSelectStock={onSelectStock} />
      ) : category === "global" ? (
        <GlobalStocksPanel onSelectStock={onSelectStock} />
      ) : (
        <CategoryBoard
          key={category}
          category={category}
          onSelectStock={onSelectStock}
        />
      )}
    </div>
  );
}

function MegaCapPanel({
  onSelectStock,
}: {
  onSelectStock: (symbol: string) => void;
}) {
  const [payload, setPayload] = useState<MegaCapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MegaCapSort>("marketCap");
  const [descending, setDescending] = useState(true);
  const refreshInFlightRef = useRef(false);

  const loadMegaCaps = useCallback(async (quiet = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/mega-cap", { cache: "no-store" });
      if (!response.ok) throw new Error("Market-cap screen unavailable");
      const nextPayload = await response.json() as MegaCapPayload;
      if (!Array.isArray(nextPayload.stocks) || !nextPayload.stocks.length) {
        throw new Error("No stocks returned");
      }
      setPayload(nextPayload);
      setError(null);
    } catch {
      setError("The live Mega 50 screen is temporarily unavailable.");
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadMegaCaps();
    const refresh = window.setInterval(() => void loadMegaCaps(true), 1_000);
    return () => window.clearInterval(refresh);
  }, [loadMegaCaps]);

  const marketCapLeaders = useMemo(
    () => [...(payload?.stocks || [])].sort((a, b) => b.marketCap - a.marketCap),
    [payload],
  );
  const topThree = marketCapLeaders.slice(0, 3);
  const advancers = marketCapLeaders.filter((stock) => stock.changePercent >= 0).length;
  const largestMover = marketCapLeaders.reduce<MegaCapStock | null>(
    (leader, stock) => (
      !leader || Math.abs(stock.changePercent) > Math.abs(leader.changePercent) ? stock : leader
    ),
    null,
  );
  const medianMarketCap = marketCapLeaders.length
    ? marketCapLeaders[Math.floor(marketCapLeaders.length / 2)].marketCap
    : 0;

  const visibleStocks = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();
    const filtered = (payload?.stocks || []).filter((stock) => (
      !normalizedSearch
      || stock.symbol.toUpperCase().includes(normalizedSearch)
      || stock.name.toUpperCase().includes(normalizedSearch)
      || stock.exchange.toUpperCase().includes(normalizedSearch)
    ));
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sort === "name") comparison = a.name.localeCompare(b.name);
      else comparison = a[sort] - b[sort];
      return descending ? -comparison : comparison;
    });
  }, [descending, payload, search, sort]);

  function chooseSort(nextSort: MegaCapSort) {
    if (sort === nextSort) {
      setDescending((current) => !current);
      return;
    }
    setSort(nextSort);
    setDescending(nextSort !== "name");
  }

  const updatedLabel = payload
    ? new Date(payload.fetchedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <section className="mega-page">
      <div className="mega-hero">
        <div className="mega-hero-copy">
          <span className="eyebrow">MARKET-CAP LEADERBOARD</span>
          <h1>The Mega 50</h1>
          <p>
            The 50 largest equity listings in Yahoo Finance&apos;s U.S. market screen,
            ranked by current market capitalization.
          </p>
        </div>
        <div className="mega-hero-status">
          <span className={error && !payload ? "offline" : ""} />
          <div>
            <strong>{refreshing ? "REFRESHING" : payload ? `${payload.count} VERIFIED LISTINGS` : "CONNECTING"}</strong>
            <small>Updated {updatedLabel} · checks every 1s</small>
          </div>
        </div>
      </div>

      {error && (
        <div className="mega-error" role="status">
          <span>{error}</span>
          {payload && <small>Keeping the last verified ranking on screen.</small>}
          <button type="button" onClick={() => void loadMegaCaps()}>Retry</button>
        </div>
      )}

      {loading && !payload ? (
        <div className="mega-loading panel">
          <span />
          <strong>Building the live ranking…</strong>
          <small>Loading prices and market capitalizations from Yahoo Finance.</small>
        </div>
      ) : payload ? (
        <>
          <div className="mega-summary">
            <div>
              <span>SCREEN LEADER</span>
              <strong>{marketCapLeaders[0]?.symbol || "—"}</strong>
              <small>{marketCapLeaders[0] ? formatMarketCap(marketCapLeaders[0].marketCap) : "—"}</small>
            </div>
            <div>
              <span>ADVANCERS</span>
              <strong>{advancers}<i> / {payload.count}</i></strong>
              <small>Non-negative today</small>
            </div>
            <div>
              <span>LARGEST MOVE</span>
              <strong>{largestMover?.symbol || "—"}</strong>
              <small>{largestMover ? `${largestMover.changePercent >= 0 ? "+" : ""}${largestMover.changePercent.toFixed(2)}%` : "—"}</small>
            </div>
            <div>
              <span>MEDIAN SIZE</span>
              <strong>{medianMarketCap ? formatMarketCap(medianMarketCap) : "—"}</strong>
              <small>Market capitalization</small>
            </div>
          </div>

          <div className="mega-podium" aria-label="Top three market-cap listings">
            {topThree.map((stock, index) => (
              <button
                type="button"
                className={`mega-leader rank-${index + 1}`}
                key={stock.symbol}
                onClick={() => onSelectStock(stock.symbol)}
              >
                <span className="mega-rank">0{index + 1}</span>
                <div>
                  <small>{stock.name}</small>
                  <strong>{stock.symbol}</strong>
                </div>
                <div className="mega-leader-value">
                  <strong>{formatMarketCap(stock.marketCap)}</strong>
                  <span className={stock.changePercent >= 0 ? "up-text" : "down-text"}>
                    {stock.changePercent >= 0 ? "+" : ""}{stock.changePercent.toFixed(2)}%
                  </span>
                </div>
              </button>
            ))}
          </div>

          <section className="mega-table-card panel">
            <div className="mega-toolbar">
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search the Mega 50"
                  aria-label="Search Mega 50 stocks"
                />
              </label>
              <div className="mega-sort" aria-label="Sort Mega 50">
                <span>SORT</span>
                {([
                  ["marketCap", "Market cap"],
                  ["changePercent", "Daily move"],
                  ["price", "Price"],
                  ["name", "Name"],
                ] as Array<[MegaCapSort, string]>).map(([value, label]) => (
                  <button
                    type="button"
                    className={sort === value ? "active" : ""}
                    key={value}
                    onClick={() => chooseSort(value)}
                  >
                    {label}{sort === value ? (descending ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </div>
              <button
                className="mega-refresh"
                type="button"
                onClick={() => void loadMegaCaps(true)}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
            </div>

            <div className="mega-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Company</th>
                    <th>Exchange</th>
                    <th>Last price</th>
                    <th>Daily move</th>
                    <th>Market cap</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStocks.map((stock) => (
                    <tr key={stock.symbol}>
                      <td><span className="mega-table-rank">{String(stock.rank).padStart(2, "0")}</span></td>
                      <td>
                        <button
                          type="button"
                          className="mega-company"
                          onClick={() => onSelectStock(stock.symbol)}
                        >
                          <span>{stock.symbol.slice(0, 1)}</span>
                          <div>
                            <strong>{stock.symbol}</strong>
                            <small>{stock.name}</small>
                          </div>
                        </button>
                      </td>
                      <td><span className="mega-exchange">{stock.exchange}</span></td>
                      <td>{formatMoney(stock.price, stock.currency)}</td>
                      <td>
                        <span className={stock.changePercent >= 0 ? "mega-move up" : "mega-move down"}>
                          {stock.changePercent >= 0 ? "↗ +" : "↘ "}{stock.changePercent.toFixed(2)}%
                        </span>
                      </td>
                      <td><strong>{formatMarketCap(stock.marketCap)}</strong></td>
                      <td>
                        <button
                          type="button"
                          className="mega-open"
                          onClick={() => onSelectStock(stock.symbol)}
                          aria-label={`Open ${stock.symbol} in market dashboard`}
                        >
                          View ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleStocks.length && (
                <div className="mega-empty">
                  No Mega 50 listings match “{search}”.
                </div>
              )}
            </div>
          </section>

          <p className="mega-footnote">
            Ranking, market capitalization, and prices come from Yahoo Finance&apos;s largest-market-cap screen.
            Prices may be delayed. Share classes and U.S.-traded foreign listings can appear separately.
          </p>
        </>
      ) : null}
    </section>
  );
}

type FinderCompany = {
  rank: number;
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  currency: string;
  exchange: string;
  marketState: string;
  marketCap: number | null;
  marketCapAsOf: string | null;
  marketCapCurrency: string;
  sector: string;
  industry: string;
  themeSeed: boolean;
};

type FinderPayload = {
  query: string;
  expandedQueries: string[];
  fetchedAt: string;
  count: number;
  marketCapCoverage: number;
  companies: FinderCompany[];
};

const FINDER_EXAMPLES = [
  "nuclear power",
  "military defense",
  "artificial intelligence",
  "cybersecurity",
  "solar energy",
  "quantum computing",
  "space technology",
];

const FINDER_CATEGORY_GROUPS = [
  {
    label: "Technology",
    categories: ["artificial intelligence", "semiconductors", "software", "cloud computing", "cybersecurity", "computer hardware", "data centers", "robotics", "quantum computing"],
  },
  {
    label: "Finance",
    categories: ["banking", "insurance", "asset management", "payments", "fintech", "stock exchanges"],
  },
  {
    label: "Healthcare",
    categories: ["pharmaceuticals", "biotechnology", "medical devices", "health insurance", "hospitals", "gene therapy"],
  },
  {
    label: "Energy",
    categories: ["oil and gas", "nuclear power", "solar energy", "wind energy", "hydrogen", "uranium", "lithium batteries"],
  },
  {
    label: "Consumer",
    categories: ["retail", "e-commerce", "automotive", "electric vehicles", "food and beverages", "restaurants", "luxury goods", "travel and hotels", "airlines", "video games"],
  },
  {
    label: "Industrials",
    categories: ["military defense", "aerospace", "construction", "industrial machinery", "logistics", "railroads", "shipping", "waste management", "space technology"],
  },
  {
    label: "Communication",
    categories: ["telecommunications", "streaming media", "social media", "advertising"],
  },
  {
    label: "Materials",
    categories: ["gold mining", "copper mining", "steel", "chemicals", "agriculture"],
  },
  {
    label: "Property & utilities",
    categories: ["REITs", "data center REITs", "homebuilders", "electric utilities", "water utilities"],
  },
  {
    label: "Other themes",
    categories: ["cannabis", "education technology", "online learning", "satellites", "recycling"],
  },
];

function formatFinderMarketCap(value: number | null, currency: string) {
  if (value === null) return "Not reported";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
  return currency === "USD" ? `$${formatted}` : `${currency} ${formatted}`;
}

function CompanyFinderPanel({
  onSelectStock,
}: {
  onSelectStock: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("nuclear power");
  const [payload, setPayload] = useState<FinderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (rawQuery: string) => {
    const clean = rawQuery.trim().replace(/\s+/g, " ").slice(0, 80);
    if (clean.length < 2) {
      setPayload(null);
      setLoading(false);
      setError("Type at least two characters.");
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/company-finder?q=${encodeURIComponent(clean)}&finderVersion=3`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const nextPayload = await response.json() as FinderPayload & { error?: string };
      if (!response.ok) throw new Error(nextPayload.error || "Company search failed");
      setPayload(nextPayload);
    } catch (searchError: unknown) {
      if (searchError instanceof DOMException && searchError.name === "AbortError") return;
      setError(searchError instanceof Error ? searchError.message : "Company search is temporarily unavailable.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    const delay = window.setTimeout(() => void runSearch(clean), 650);
    return () => window.clearTimeout(delay);
  }, [query, runSearch]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  function chooseExample(example: string) {
    setQuery(example);
    void runSearch(example);
  }

  const largestCompany = payload?.companies.find((company) => company.marketCap !== null) || null;
  const advancers = payload?.companies.filter((company) => company.changePercent >= 0).length || 0;
  const updatedLabel = payload
    ? new Date(payload.fetchedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <section className="finder-page">
      <div className="finder-hero">
        <div>
          <span className="eyebrow">THEMATIC COMPANY DISCOVERY</span>
          <h1>Find the companies behind an idea.</h1>
          <p>
            Type a product, industry, or theme. Ledger finds matching public companies,
            verifies their market data, and ranks them from biggest to smallest.
          </p>
        </div>
        <div className="finder-example">
          <span>TRY THE EXAMPLE</span>
          <strong>“nuclear power”</strong>
          <small>Operators · fuel · reactors · engineering</small>
        </div>
      </div>

      <form className="finder-search panel" onSubmit={submitSearch}>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try nuclear power, robotics, cloud computing…"
          aria-label="Find companies by business theme"
          autoComplete="off"
        />
        <div className="finder-search-state">
          <span className={loading ? "working" : ""} />
          <small>{loading ? "SEARCHING" : "AUTO SEARCH ON"}</small>
        </div>
        <button type="submit" disabled={loading || query.trim().length < 2}>
          {loading ? "Finding…" : "Find companies"}
        </button>
      </form>

      <div className="finder-suggestions" aria-label="Example company themes">
        <span>POPULAR THEMES</span>
        {FINDER_EXAMPLES.map((example) => (
          <button
            type="button"
            className={query.toLowerCase() === example ? "active" : ""}
            key={example}
            onClick={() => chooseExample(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <details className="finder-library panel">
        <summary>
          <span>
            <strong>Browse every category</strong>
            <small>{FINDER_CATEGORY_GROUPS.reduce((total, group) => total + group.categories.length, 0)} industries and themes</small>
          </span>
          <i>＋</i>
        </summary>
        <div className="finder-library-grid">
          {FINDER_CATEGORY_GROUPS.map((group) => (
            <section key={group.label}>
              <span>{group.label}</span>
              <div>
                {group.categories.map((category) => (
                  <button
                    type="button"
                    className={query.toLowerCase() === category.toLowerCase() ? "active" : ""}
                    key={category}
                    onClick={() => chooseExample(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </details>

      {error && (
        <div className="mega-error finder-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void runSearch(query)}>Retry</button>
        </div>
      )}

      {loading && !payload ? (
        <div className="mega-loading finder-loading panel">
          <span />
          <strong>Mapping “{query}” to public companies…</strong>
          <small>Searching company records and checking reported market capitalizations.</small>
        </div>
      ) : payload ? (
        <>
          <div className="finder-result-heading">
            <div>
              <span className="eyebrow">RESULTS FOR</span>
              <h2>“{payload.query}”</h2>
            </div>
            <div>
              <span className={loading ? "working" : ""} />
              <strong>{loading ? "UPDATING RESULTS" : `UPDATED ${updatedLabel}`}</strong>
            </div>
          </div>

          <div className="mega-summary finder-summary">
            <div>
              <span>COMPANIES FOUND</span>
              <strong>{payload.count}</strong>
              <small>Publicly traded matches</small>
            </div>
            <div>
              <span>LARGEST MATCH</span>
              <strong>{largestCompany?.symbol || "—"}</strong>
              <small>{largestCompany ? formatFinderMarketCap(largestCompany.marketCap, largestCompany.marketCapCurrency) : "No cap reported"}</small>
            </div>
            <div>
              <span>MARKET-CAP COVERAGE</span>
              <strong>{payload.marketCapCoverage}<i> / {payload.count}</i></strong>
              <small>Rankable company values</small>
            </div>
            <div>
              <span>ADVANCERS</span>
              <strong>{advancers}<i> / {payload.count}</i></strong>
              <small>Non-negative today</small>
            </div>
          </div>

          {payload.companies.length ? (
            <section className="mega-table-card finder-table panel">
              <div className="finder-table-title">
                <div>
                  <span className="eyebrow">BIGGEST TO SMALLEST</span>
                  <h2>Company ranking</h2>
                </div>
                <span>MARKET CAP ORDER</span>
              </div>
              <div className="mega-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Company</th>
                      <th>Theme / industry</th>
                      <th>Last price</th>
                      <th>Daily move</th>
                      <th>Market cap</th>
                      <th><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.companies.map((company) => (
                      <tr key={company.symbol}>
                        <td><span className="mega-table-rank">{String(company.rank).padStart(2, "0")}</span></td>
                        <td>
                          <button
                            type="button"
                            className="mega-company"
                            onClick={() => onSelectStock(company.symbol)}
                          >
                            <span>{company.symbol.replace(/[^A-Z0-9]/g, "").slice(0, 1)}</span>
                            <div>
                              <strong>{company.symbol}</strong>
                              <small>{company.name}</small>
                            </div>
                          </button>
                        </td>
                        <td>
                          <div className="finder-industry">
                            <strong>{company.industry}</strong>
                            <small>{company.sector}</small>
                          </div>
                        </td>
                        <td><strong>{formatBoardPrice(company.price)}</strong> <small>{company.currency}</small></td>
                        <td>
                          <span className={company.changePercent >= 0 ? "mega-move up" : "mega-move down"}>
                            {company.changePercent >= 0 ? "↗ +" : "↘ "}{company.changePercent.toFixed(2)}%
                          </span>
                        </td>
                        <td>
                          <div className="finder-cap">
                            <strong>{formatFinderMarketCap(company.marketCap, company.marketCapCurrency)}</strong>
                            <small>{company.marketCapAsOf ? `As of ${company.marketCapAsOf}` : "Yahoo did not report a value"}</small>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mega-open"
                            onClick={() => onSelectStock(company.symbol)}
                            aria-label={`Open ${company.symbol} in market dashboard`}
                          >
                            View ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="finder-empty panel">
              <span>?</span>
              <h2>No verified public-company matches</h2>
              <p>Try a broader industry phrase, a product name, or one of the example themes above.</p>
            </div>
          )}

          <div className="finder-method">
            <strong>How matching works</strong>
            <p>
              Ledger combines Yahoo company search with verified theme mappings, then ranks available
              market capitalizations. It is a discovery screen—not an exhaustive legal classification
              of every company with indirect exposure to a theme.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

type CongressTrade = {
  id: string;
  member: string;
  memberSlug: string;
  chamber: "house" | "senate";
  state: string;
  ticker: string;
  asset: string;
  type: "purchase" | "sale" | "exchange" | "other";
  amountLow: number;
  amountHigh: number;
  amountMidpoint: number;
  amountRange: string;
  transactionDate: string;
  disclosureDate: string;
  filingLagDays: number;
  estimatedPrice: number;
  recentPrice: number;
  recentPriceDate: string;
  performancePercent: number | null;
  realizedReturnPercent: number | null;
  outcome: string;
  filingPortal: string;
  flags: string[];
  attentionScore: number;
  attention: "high" | "review" | "routine";
};

type CongressPayload = {
  source: string;
  sourceNote: string;
  fetchedAt: string;
  latestDisclosure: string;
  count: number;
  totals: {
    trades: number;
    members: number;
    tickers: number;
    buys: number;
    sells: number;
  };
  trending: Array<{
    ticker: string;
    trades: number;
    buys: number;
    sells: number;
    members: number;
  }>;
  trades: CongressTrade[];
  officialSources: { house: string; senate: string };
};

type CongressMember = {
  rank: number;
  featured: boolean;
  slug: string;
  name: string;
  party: string;
  state: string;
  district: string;
  chamber: "house" | "senate";
  imageUrl: string;
  inOffice: boolean;
  tradeCount: number;
  conflictTrades: number;
  averageConflict: number;
  latestTrade: string;
  website: string;
  termStart: string;
  termEnd: string;
};

type CongressMemberTrade = {
  id: string;
  ticker: string;
  asset: string;
  type: "purchase" | "sale" | "exchange";
  transactionDate: string;
  disclosureDate: string;
  filingLagDays: number;
  amountLow: number;
  amountHigh: number;
  amountMidpoint: number;
  amountRange: string;
  owner: string;
  conflictScore: number;
  conflictFlags: string[];
  sourceUrl: string;
};

type CongressPositionEstimate = {
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
  grossFlow: number;
  netFlow: number;
  owners: string[];
};

type CongressMemberProfile = {
  source: string;
  fetchedAt: string;
  member: CongressMember;
  summary: {
    trades: number;
    assets: number;
    grossVolume: number;
    purchaseVolume: number;
    saleVolume: number;
    purchaseCount: number;
    saleCount: number;
    averageLag: number;
    lateFilings: number;
    firstTrade: string;
    latestTrade: string;
    owners: string[];
    complete: boolean;
    sourceRecords: number;
    duplicateRecordsRemoved: number;
  };
  positions: CongressPositionEstimate[];
  trades: CongressMemberTrade[];
  note: string;
};

type CongressRankingPayload = {
  source: string;
  fetchedAt: string;
  methodology: string;
  members: CongressMember[];
};

type CongressPerformance = {
  symbol: string;
  purchaseDate: string;
  referenceDate: string;
  referencePrice: number;
  currentPrice: number;
  currentPriceTime: number | null;
  currency: string;
  change: number;
  changePercent: number;
  methodology: string;
};

type CongressSort = "newest" | "size" | "move" | "lag" | "attention";

const CONGRESS_TRACKED_KEY = "ledger-congress-tracked-tickers";

function congressDate(value: string, includeYear = false) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}

function congressMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

const congressPerformanceCache = new Map<string, CongressPerformance | null>();
const congressPerformanceRequests = new Map<string, Promise<CongressPerformance | null>>();

function congressPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: value < 10 ? 2 : 1,
  }).format(value);
}

function loadCongressPerformance(symbol: string, purchaseDate: string) {
  const key = `${symbol}|${purchaseDate}`;
  if (congressPerformanceCache.has(key)) return Promise.resolve(congressPerformanceCache.get(key) || null);
  const existing = congressPerformanceRequests.get(key);
  if (existing) return existing;
  const request = fetch(`/api/congress-performance?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(purchaseDate)}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      return response.json() as Promise<CongressPerformance>;
    })
    .catch(() => null)
    .then((result) => {
      congressPerformanceCache.set(key, result);
      congressPerformanceRequests.delete(key);
      return result;
    });
  congressPerformanceRequests.set(key, request);
  return request;
}

function CongressPerformanceCell({ symbol, purchaseDate }: { symbol: string; purchaseDate: string }) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [performance, setPerformance] = useState<CongressPerformance | null | undefined>(() => (
    congressPerformanceCache.get(`${symbol}|${purchaseDate}`)
  ));
  const [requested, setRequested] = useState(() => congressPerformanceCache.has(`${symbol}|${purchaseDate}`));

  useEffect(() => {
    if (!symbol || !purchaseDate || requested) return;
    const element = cellRef.current;
    if (!element) return;
    const root = element.closest(".congress-profile-table-wrap");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setRequested(true);
      void loadCongressPerformance(symbol, purchaseDate).then(setPerformance);
      observer.disconnect();
    }, { root, rootMargin: "180px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [purchaseDate, requested, symbol]);

  if (!purchaseDate) return <div className="congress-performance-cell unavailable"><strong>NO BUY</strong><small>No disclosed purchase</small></div>;
  if (performance === undefined) return <div ref={cellRef} className="congress-performance-cell loading"><strong>Calculating…</strong><small>From {congressDate(purchaseDate, true)}</small></div>;
  if (performance === null) return <div ref={cellRef} className="congress-performance-cell unavailable"><strong>UNAVAILABLE</strong><small>No comparable price</small></div>;
  const positive = performance.changePercent >= 0;
  return (
    <div ref={cellRef} className={`congress-performance-cell ${positive ? "positive" : "negative"}`} title={performance.methodology}>
      <strong>{positive ? "+" : ""}{performance.changePercent.toFixed(1)}%</strong>
      <small>{congressPrice(performance.referencePrice, performance.currency)} → {congressPrice(performance.currentPrice, performance.currency)}</small>
      <em>since {congressDate(performance.purchaseDate, true)}{performance.referenceDate !== performance.purchaseDate ? ` · priced ${congressDate(performance.referenceDate, true)}` : ""}</em>
    </div>
  );
}

function CongressTradingPanel({ onSelectStock }: { onSelectStock: (symbol: string) => void }) {
  const [data, setData] = useState<CongressPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chamber, setChamber] = useState<"all" | "house" | "senate">("all");
  const [tradeType, setTradeType] = useState<"all" | "purchase" | "sale">("all");
  const [attention, setAttention] = useState<"all" | "flagged" | "late">("all");
  const [sort, setSort] = useState<CongressSort>("newest");
  const [trackedTickers, setTrackedTickers] = useState<string[]>([]);
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<CongressTrade | null>(null);
  const [memberRanking, setMemberRanking] = useState<CongressRankingPayload | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [profile, setProfile] = useState<CongressMemberProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<"portfolio" | "trades">("portfolio");
  const [profileTradeLimit, setProfileTradeLimit] = useState(100);
  const profileCacheRef = useRef(new Map<string, CongressMemberProfile>());

  const loadTrades = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/congress-trades", { cache: "no-store" });
      const payload = await response.json() as CongressPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Disclosure feed unavailable");
      setData(payload);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Disclosure feed unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMemberProfile = useCallback(async (slug: string) => {
    const cached = profileCacheRef.current.get(slug);
    if (cached) {
      setProfile(cached);
      setProfileError(null);
      setProfileTab("portfolio");
      setProfileTradeLimit(100);
      return;
    }
    setProfileLoading(true);
    setProfileError(null);
    setProfileTab("portfolio");
    setProfileTradeLimit(100);
    try {
      const response = await fetch(`/api/congress-members?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const payload = await response.json() as CongressMemberProfile & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Member profile unavailable");
      profileCacheRef.current.set(slug, payload);
      setProfile(payload);
    } catch (loadError: unknown) {
      setProfileError(loadError instanceof Error ? loadError.message : "Member profile unavailable");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(CONGRESS_TRACKED_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTrackedTickers(parsed.filter((item): item is string => typeof item === "string").slice(0, 20));
        }
      } catch {
        window.localStorage.removeItem(CONGRESS_TRACKED_KEY);
      }
    }
    void loadTrades(false);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadTrades(true);
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [loadTrades]);

  useEffect(() => {
    const controller = new AbortController();
    setRankingLoading(true);
    fetch("/api/congress-members", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CongressRankingPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Congress ranking unavailable");
        return payload;
      })
      .then((payload) => {
        setMemberRanking(payload);
        const firstSlug = payload.members[0]?.slug;
        if (firstSlug) void loadMemberProfile(firstSlug);
      })
      .catch((rankingError: unknown) => {
        if (rankingError instanceof DOMException && rankingError.name === "AbortError") return;
        setProfileError(rankingError instanceof Error ? rankingError.message : "Congress ranking unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRankingLoading(false);
      });
    return () => controller.abort();
  }, [loadMemberProfile]);

  function toggleTracked(ticker: string) {
    if (!ticker || ticker === "N/A") return;
    setTrackedTickers((current) => {
      const next = current.includes(ticker)
        ? current.filter((item) => item !== ticker)
        : [ticker, ...current].slice(0, 20);
      window.localStorage.setItem(CONGRESS_TRACKED_KEY, JSON.stringify(next));
      return next;
    });
  }

  const filteredTrades = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...(data?.trades || [])]
      .filter((trade) => chamber === "all" || trade.chamber === chamber)
      .filter((trade) => tradeType === "all" || trade.type === tradeType)
      .filter((trade) => attention === "all" || (attention === "flagged" ? trade.attention !== "routine" : trade.filingLagDays > 45))
      .filter((trade) => !trackedOnly || trackedTickers.includes(trade.ticker))
      .filter((trade) => !normalizedQuery || [trade.member, trade.ticker, trade.asset, trade.state]
        .some((value) => value.toLowerCase().includes(normalizedQuery)))
      .sort((left, right) => {
        if (sort === "size") return right.amountHigh - left.amountHigh;
        if (sort === "move") return Math.abs(right.performancePercent || 0) - Math.abs(left.performancePercent || 0);
        if (sort === "lag") return right.filingLagDays - left.filingLagDays;
        if (sort === "attention") return right.attentionScore - left.attentionScore;
        return right.disclosureDate.localeCompare(left.disclosureDate)
          || right.transactionDate.localeCompare(left.transactionDate);
      });
  }, [attention, chamber, data, query, sort, trackedOnly, trackedTickers, tradeType]);

  const summary = useMemo(() => {
    const trades = data?.trades || [];
    const purchaseFlow = trades
      .filter((trade) => trade.type === "purchase")
      .reduce((total, trade) => total + trade.amountMidpoint, 0);
    const saleFlow = trades
      .filter((trade) => trade.type === "sale")
      .reduce((total, trade) => total + trade.amountMidpoint, 0);
    return {
      purchaseFlow,
      saleFlow,
      members: new Set(trades.map((trade) => trade.member)).size,
      flagged: trades.filter((trade) => trade.attention !== "routine").length,
      late: trades.filter((trade) => trade.filingLagDays > 45).length,
      averageLag: trades.length
        ? Math.round(trades.reduce((total, trade) => total + trade.filingLagDays, 0) / trades.length)
        : 0,
    };
  }, [data]);

  const maxTrendingTrades = Math.max(1, ...(data?.trending || []).map((item) => item.trades));
  const lastChecked = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";

  return (
    <section className="congress-page">
      <section className="congress-hero">
        <div className="congress-hero-copy">
          <span className="congress-kicker"><i /> STOCK ACT DISCLOSURE INTELLIGENCE</span>
          <h1>Congress<br />trade monitor</h1>
          <p>
            Follow publicly disclosed securities transactions from members of the U.S. House and Senate.
            Ledger ranks filing delays, disclosed value ranges, and post-trade moves for research review.
          </p>
          <div className="congress-hero-actions">
            <button type="button" onClick={() => void loadTrades(true)} disabled={loading}>
              {loading ? "Checking filings…" : "Refresh disclosures"}
            </button>
            <span>Auto-check every 30 seconds · latest public filing {data?.latestDisclosure ? congressDate(data.latestDisclosure, true) : "—"}</span>
          </div>
        </div>
        <div className="congress-radar" aria-hidden="true">
          <div className="congress-radar-ring ring-one" />
          <div className="congress-radar-ring ring-two" />
          <div className="congress-radar-sweep" />
          <strong>{data?.count || 0}</strong>
          <span>RECENT RECORDS</span>
        </div>
      </section>

      <div className="congress-status-strip">
        <span className={error ? "offline" : "online"}><i /> {error ? "FEED INTERRUPTED" : "DISCLOSURE FEED ONLINE"}</span>
        <span>Last checked {lastChecked}</span>
        <span>{data?.sourceNote || "Official public records"}</span>
        <span>Public filings can lag trades by up to 45 days</span>
      </div>

      {error && (
        <div className="congress-error" role="status">
          <div><strong>Could not reach the disclosure feed</strong><span>{error}</span></div>
          <button type="button" onClick={() => void loadTrades(false)}>Try again</button>
        </div>
      )}

      <section className="congress-top10 panel">
        <div className="congress-top10-heading">
          <div>
            <span className="eyebrow">LEDGER WATCH 10</span>
            <h2>Most-watched congressional traders</h2>
            <p>Nancy Pelosi is featured first; the remaining active filers are ordered by disclosed transaction count.</p>
          </div>
          <span>Click any profile for its complete available filing history</span>
        </div>
        <div className="congress-rank-grid">
          {rankingLoading && !memberRanking ? Array.from({ length: 10 }, (_, index) => (
            <div className="congress-rank-skeleton" key={index}><i /><span /><small /></div>
          )) : (memberRanking?.members || []).map((member) => {
            const selected = profile?.member.slug === member.slug;
            return (
              <button
                type="button"
                className={`congress-rank-card ${selected ? "selected" : ""} ${member.featured ? "featured" : ""}`}
                key={member.slug}
                onClick={() => void loadMemberProfile(member.slug)}
                aria-pressed={selected}
              >
                <span className="congress-rank-number">{String(member.rank).padStart(2, "0")}</span>
                <span className={`congress-member-avatar party-${member.party.toLowerCase()}`}>{member.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
                <span className="congress-rank-name"><strong>{member.name}</strong><small>{member.chamber.toUpperCase()} · {member.party} · {member.state}</small></span>
                <span className="congress-rank-stat"><strong>{member.tradeCount.toLocaleString()}</strong><small>DISCLOSED TRADES</small></span>
                {member.featured && <i>FEATURED</i>}
              </button>
            );
          })}
        </div>
        {memberRanking?.methodology && <p className="congress-ranking-method">{memberRanking.methodology} Ranking is a watchlist, not an allegation of wrongdoing.</p>}
      </section>

      {(profileLoading || profile || profileError) && (
        <section className="congress-profile panel" aria-live="polite">
          {profileLoading ? (
            <div className="congress-profile-loading"><span className="congress-spinner" /><strong>Building the complete disclosure profile</strong><small>Collecting every available transaction page and calculating ticker-level activity…</small></div>
          ) : profileError && !profile ? (
            <div className="congress-profile-loading"><span>!</span><strong>Profile unavailable</strong><small>{profileError}</small></div>
          ) : profile ? (
            <>
              <header className="congress-profile-header">
                <div className="congress-profile-person">
                  {profile.member.imageUrl ? (
                    <img src={profile.member.imageUrl} alt="" />
                  ) : (
                    <span className={`congress-profile-avatar party-${profile.member.party.toLowerCase()}`}>{profile.member.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
                  )}
                  <div>
                    <span className="eyebrow">FULL DISCLOSURE PROFILE</span>
                    <h2>{profile.member.name}</h2>
                    <p>{profile.member.chamber === "house" ? "U.S. House" : "U.S. Senate"} · {profile.member.party} · {profile.member.state}{profile.member.district ? `-${profile.member.district}` : ""} · {profile.member.inOffice ? "In office" : "Former member"}</p>
                  </div>
                </div>
                <div className="congress-profile-window">
                  <span>AVAILABLE RECORD WINDOW</span>
                  <strong>{profile.summary.firstTrade ? congressDate(profile.summary.firstTrade, true) : "—"} — {profile.summary.latestTrade ? congressDate(profile.summary.latestTrade, true) : "—"}</strong>
                  <small>{profile.summary.complete ? "All provider records loaded" : "Provider history cap reached"}</small>
                </div>
              </header>

              <div className="congress-profile-metrics">
                <article><span>DISCLOSED TRADES</span><strong>{profile.summary.trades.toLocaleString()}</strong><small>{profile.summary.purchaseCount} buys · {profile.summary.saleCount} sells</small></article>
                <article><span>EST. GROSS FLOW</span><strong>{congressMoney(profile.summary.grossVolume)}</strong><small>Midpoints of disclosed value ranges</small></article>
                <article><span>DISTINCT TICKERS</span><strong>{profile.summary.assets}</strong><small>{profile.summary.owners.join(" · ") || "Owner not specified"}</small></article>
                <article className={profile.summary.lateFilings ? "attention" : ""}><span>FILING BEHAVIOR</span><strong>{profile.summary.averageLag}d</strong><small>Average lag · {profile.summary.lateFilings} reports over 45d</small></article>
              </div>

              <div className="congress-profile-note">
                <span>ESTIMATE, NOT BROKERAGE HOLDINGS</span>
                <p>{profile.note}</p>
              </div>

              <nav className="congress-profile-tabs" aria-label="Member disclosure profile sections">
                <button type="button" className={profileTab === "portfolio" ? "active" : ""} onClick={() => setProfileTab("portfolio")}>Portfolio activity <span>{profile.positions.length}</span></button>
                <button type="button" className={profileTab === "trades" ? "active" : ""} onClick={() => setProfileTab("trades")}>Full trade ledger <span>{profile.trades.length}</span></button>
                {profile.member.website && <a href={profile.member.website} target="_blank" rel="noreferrer">Official website ↗</a>}
              </nav>

              {profileTab === "portfolio" ? (
                <div className="congress-profile-table-wrap">
                  <table className="congress-portfolio-table">
                    <thead><tr><th>Asset / chart</th><th>Owners</th><th>Buys</th><th>Sells</th><th>Est. buy flow</th><th>Est. sell flow</th><th>Stock move since latest buy</th><th>Latest activity</th></tr></thead>
                    <tbody>
                      {profile.positions.map((position) => (
                        <tr key={position.ticker}>
                          <td><button type="button" onClick={() => onSelectStock(position.marketSymbol || position.ticker)} aria-label={`Open ${position.ticker} chart`}>{position.ticker} ↗</button><small>{position.asset}</small></td>
                          <td><strong>{position.owners.join(" · ")}</strong></td>
                          <td><strong className="up-text">{position.purchaseCount}</strong></td>
                          <td><strong className="down-text">{position.saleCount}</strong></td>
                          <td>{congressMoney(position.purchases)}</td>
                          <td>{congressMoney(position.sales)}</td>
                          <td><CongressPerformanceCell key={`${position.marketSymbol || position.ticker}|${position.latestPurchaseDate}`} symbol={position.marketSymbol || position.ticker} purchaseDate={position.latestPurchaseDate} /></td>
                          <td><strong>{position.latestAction.toUpperCase()}</strong><small>{congressDate(position.latestDate, true)}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div className="congress-profile-table-wrap">
                    <table className="congress-history-table">
                      <thead><tr><th>Date</th><th>Asset / chart</th><th>Action</th><th>Disclosed range</th><th>Stock move since buy</th><th>Owner</th><th>Filed</th><th>Lag</th><th>Source</th></tr></thead>
                      <tbody>
                        {profile.trades.slice(0, profileTradeLimit).map((trade) => (
                          <tr key={trade.id}>
                            <td><strong>{congressDate(trade.transactionDate, true)}</strong></td>
                            <td>{trade.ticker !== "N/A" ? <button type="button" onClick={() => onSelectStock(trade.ticker.replace(/\.([A-Z])$/, "-$1"))} aria-label={`Open ${trade.ticker} chart`}>{trade.ticker} ↗</button> : <strong>N/A</strong>}<small>{trade.asset}</small></td>
                            <td><span className={`congress-action ${trade.type}`}>{trade.type === "purchase" ? "BUY" : trade.type === "sale" ? "SELL" : "EXCHANGE"}</span></td>
                            <td><strong>{trade.amountRange}</strong></td>
                            <td>{trade.type === "purchase" && trade.ticker !== "N/A" ? <CongressPerformanceCell key={`${trade.ticker}|${trade.transactionDate}`} symbol={trade.ticker.replace(/\.([A-Z])$/, "-$1")} purchaseDate={trade.transactionDate} /> : <span className="congress-return-na">—</span>}</td>
                            <td>{trade.owner}</td>
                            <td>{congressDate(trade.disclosureDate, true)}</td>
                            <td><strong className={trade.filingLagDays > 45 ? "down-text" : ""}>{trade.filingLagDays}d</strong></td>
                            <td><a href={trade.sourceUrl} target="_blank" rel="noreferrer">Filing ↗</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {profileTradeLimit < profile.trades.length && (
                    <button type="button" className="congress-show-all" onClick={() => setProfileTradeLimit(profile.trades.length)}>Show all {profile.trades.length.toLocaleString()} transactions</button>
                  )}
                </>
              )}
            </>
          ) : null}
        </section>
      )}

      <section className="congress-metrics" aria-label="Congress trading summary">
        <article>
          <span>DISCLOSURES TRACKED</span>
          <strong>{data?.totals.trades.toLocaleString() || "—"}</strong>
          <small>{data?.totals.members.toLocaleString() || "—"} filers · current 30-day disclosure window</small>
        </article>
        <article>
          <span>RECENT EST. BUY FLOW</span>
          <strong>{congressMoney(summary.purchaseFlow)}</strong>
          <small>Midpoint estimate · latest {data?.count || 0} records</small>
        </article>
        <article>
          <span>RECENT EST. SELL FLOW</span>
          <strong>{congressMoney(summary.saleFlow)}</strong>
          <small>Midpoint estimate · ranges are not exact values</small>
        </article>
        <article className={summary.flagged ? "attention" : ""}>
          <span>RESEARCH FLAGS</span>
          <strong>{summary.flagged}</strong>
          <small>{summary.late} over 45 days · {summary.averageLag}d average filing lag</small>
        </article>
      </section>

      <section className="congress-tracker panel">
        <div className="congress-tracker-heading">
          <div>
            <span className="eyebrow">YOUR CONGRESS SIGNAL LIST</span>
            <h2>Tracked tickers</h2>
          </div>
          <button type="button" className={trackedOnly ? "active" : ""} onClick={() => setTrackedOnly((current) => !current)}>
            {trackedOnly ? "Showing tracked only" : "Show tracked only"}
          </button>
        </div>
        <div className="congress-tracked-list">
          {trackedTickers.length ? trackedTickers.map((ticker) => (
            <button type="button" key={ticker} onClick={() => setQuery(ticker)}>
              <strong>{ticker}</strong><span onClick={(event) => { event.stopPropagation(); toggleTracked(ticker); }} aria-label={`Stop tracking ${ticker}`}>×</span>
            </button>
          )) : (
            <p>Use the ☆ beside any disclosure to build a ticker alert list on this device.</p>
          )}
        </div>
      </section>

      <div className="congress-workspace">
        <section className="congress-ledger panel">
          <div className="congress-ledger-heading">
            <div>
              <span className="eyebrow">LATEST PUBLIC FILINGS</span>
              <h2>Disclosure ledger</h2>
            </div>
            <span>{filteredTrades.length} matching records</span>
          </div>

          <div className="congress-controls">
            <label className="congress-search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search member, ticker, company, or state" aria-label="Search Congress disclosures" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
            </label>
            <select value={chamber} onChange={(event) => setChamber(event.target.value as typeof chamber)} aria-label="Filter by chamber">
              <option value="all">Both chambers</option>
              <option value="house">House</option>
              <option value="senate">Senate</option>
            </select>
            <select value={tradeType} onChange={(event) => setTradeType(event.target.value as typeof tradeType)} aria-label="Filter by transaction type">
              <option value="all">Buys & sells</option>
              <option value="purchase">Purchases</option>
              <option value="sale">Sales</option>
            </select>
            <select value={attention} onChange={(event) => setAttention(event.target.value as typeof attention)} aria-label="Filter by research flag">
              <option value="all">All signals</option>
              <option value="flagged">Flagged only</option>
              <option value="late">Filed after 45d</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as CongressSort)} aria-label="Sort disclosures">
              <option value="newest">Newest filed</option>
              <option value="attention">Highest attention</option>
              <option value="size">Largest range</option>
              <option value="move">Largest move</option>
              <option value="lag">Longest filing lag</option>
            </select>
          </div>

          <div className="congress-table-wrap">
            {loading && !data ? (
              <div className="congress-empty"><span className="congress-spinner" /><strong>Loading public disclosures</strong><small>Checking House and Senate transaction records…</small></div>
            ) : filteredTrades.length ? (
              <table>
                <thead><tr><th>Track</th><th>Member</th><th>Asset</th><th>Action</th><th>Disclosed value</th><th>Trade / filed</th><th>Move since</th><th>Signal</th></tr></thead>
                <tbody>
                  {filteredTrades.map((trade) => (
                    <tr key={trade.id} className={selectedTrade?.id === trade.id ? "selected" : ""} onClick={() => setSelectedTrade(trade)}>
                      <td>
                        <button type="button" className={`congress-star ${trackedTickers.includes(trade.ticker) ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); toggleTracked(trade.ticker); }} aria-label={`${trackedTickers.includes(trade.ticker) ? "Stop" : "Start"} tracking ${trade.ticker}`}>{trackedTickers.includes(trade.ticker) ? "★" : "☆"}</button>
                      </td>
                      <td><strong>{trade.member}</strong><small>{trade.chamber === "house" ? "HOUSE" : "SENATE"} · {trade.state}</small></td>
                      <td><button type="button" className="congress-ticker" onClick={(event) => { event.stopPropagation(); onSelectStock(trade.ticker); }}>{trade.ticker}</button><small>{trade.asset}</small></td>
                      <td><span className={`congress-action ${trade.type}`}>{trade.type === "purchase" ? "BUY" : trade.type === "sale" ? "SELL" : trade.type.toUpperCase()}</span></td>
                      <td><strong>{trade.amountRange}</strong><small>Midpoint {congressMoney(trade.amountMidpoint)}</small></td>
                      <td><strong>{congressDate(trade.transactionDate)} → {congressDate(trade.disclosureDate)}</strong><small className={trade.filingLagDays > 45 ? "late" : ""}>{trade.filingLagDays} day lag</small></td>
                      <td>{trade.performancePercent === null ? <><strong>—</strong><small>Not supplied</small></> : <><strong className={trade.performancePercent >= 0 ? "up-text" : "down-text"}>{trade.performancePercent >= 0 ? "+" : ""}{trade.performancePercent.toFixed(1)}%</strong><small>Provider estimate</small></>}</td>
                      <td><span className={`congress-attention ${trade.attention}`}>{trade.attention === "high" ? "HIGH" : trade.attention === "review" ? "REVIEW" : "ROUTINE"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="congress-empty"><span>◎</span><strong>No matching disclosures</strong><small>Clear one or more filters to widen the ledger.</small></div>
            )}
          </div>
        </section>

        <aside className="congress-sidebar">
          <section className="congress-trending panel">
            <div className="congress-side-heading"><span className="eyebrow">90-DAY PULSE</span><h2>Most traded</h2></div>
            <div className="congress-trending-list">
              {(data?.trending || []).slice(0, 8).map((item, index) => (
                <button type="button" key={item.ticker} onClick={() => setQuery(item.ticker)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.ticker}</strong>
                  <i><b style={{ width: `${Math.max(8, (item.trades / maxTrendingTrades) * 100)}%` }} /></i>
                  <small>{item.trades} trades · {item.members} filers</small>
                </button>
              ))}
            </div>
          </section>

          <section className="congress-detail panel">
            {selectedTrade ? (
              <>
                <div className="congress-side-heading"><span className="eyebrow">RECORD INSPECTOR</span><h2>{selectedTrade.ticker}</h2></div>
                <div className="congress-detail-score"><span className={`congress-attention ${selectedTrade.attention}`}>{selectedTrade.attention.toUpperCase()}</span><strong>{selectedTrade.attentionScore}<small>/100</small></strong></div>
                <h3>{selectedTrade.member}</h3>
                <p>{selectedTrade.type === "purchase" ? "Purchased" : selectedTrade.type === "sale" ? "Sold" : "Reported"} {selectedTrade.asset} in a disclosed range of {selectedTrade.amountRange}.</p>
                <dl>
                  <div><dt>Transaction</dt><dd>{congressDate(selectedTrade.transactionDate, true)}</dd></div>
                  <div><dt>Disclosure</dt><dd>{congressDate(selectedTrade.disclosureDate, true)}</dd></div>
                  <div><dt>Filing lag</dt><dd>{selectedTrade.filingLagDays} days</dd></div>
                  <div><dt>Move since</dt>{selectedTrade.performancePercent === null ? <dd>Not supplied</dd> : <dd className={selectedTrade.performancePercent >= 0 ? "up-text" : "down-text"}>{selectedTrade.performancePercent >= 0 ? "+" : ""}{selectedTrade.performancePercent.toFixed(2)}%</dd>}</div>
                </dl>
                <div className="congress-flags">
                  {selectedTrade.flags.length ? selectedTrade.flags.map((flag) => <span key={flag}>⚑ {flag}</span>) : <span className="routine">No automated anomaly flags</span>}
                </div>
                <div className="congress-detail-actions">
                  <button type="button" onClick={() => onSelectStock(selectedTrade.ticker)}>Open {selectedTrade.ticker} chart</button>
                  <a href={selectedTrade.filingPortal} target="_blank" rel="noreferrer">Verify official filing ↗</a>
                </div>
              </>
            ) : (
              <div className="congress-detail-empty"><span>↳</span><strong>Select a disclosure</strong><p>Inspect dates, value ranges, price movement, automated flags, and the official filing portal.</p></div>
            )}
          </section>
        </aside>
      </div>

      <section className="congress-method">
        <div><span>01</span><strong>What this monitors</strong><p>Public Periodic Transaction Reports required under the STOCK Act. Purchases, sales, and exchanges over applicable reporting thresholds are disclosed as value ranges.</p></div>
        <div><span>02</span><strong>What the score means</strong><p>A research-priority score based on filing lag, disclosed size, and the security’s move after the transaction. It is not a legal conclusion or prediction.</p></div>
        <div><span>03</span><strong>Important limitation</strong><p>A flagged trade is not proof of insider trading. Filings may cover a spouse or dependent, and public disclosure normally arrives after the transaction.</p></div>
      </section>
      <p className="congress-disclaimer">
        For informational and research use only. Data is normalized from public House and Senate disclosures and may contain delays, amendments, OCR errors, or incomplete ticker mappings. Amounts are ranges; midpoint totals are estimates. Always verify the original filing. This is not investment or legal advice.
      </p>
    </section>
  );
}

type ArchiveGranularity = "1m" | "5m" | "1h" | "1d";

type ArchiveRow = {
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

type ArchivePayload = {
  requestedSymbol: string;
  historySymbol: string;
  proxy: boolean;
  source: string;
  currency: string;
  exchange: string;
  instrumentName: string;
  granularity: ArchiveGranularity;
  coverage: string;
  rowCount: number;
  startTime: number;
  endTime: number;
  rows: ArchiveRow[];
};

const ARCHIVE_OPTIONS: Array<{
  value: ArchiveGranularity;
  label: string;
  coverage: string;
}> = [
  { value: "1m", label: "1-minute candles", coverage: "Last 7 days" },
  { value: "5m", label: "5-minute candles", coverage: "Last 60 days" },
  { value: "1h", label: "Hourly candles", coverage: "Last 2 years" },
  { value: "1d", label: "Daily candles", coverage: "Full available history" },
];

function archiveNumber(value: number | null, maximumFractionDigits = 4) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits });
}

function archiveDate(timestamp: number, includeTime = false) {
  const date = new Date(timestamp * 1000);
  return includeTime
    ? date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function HistoryPanel({
  initialSymbol,
  tickerOptions,
}: {
  initialSymbol: string;
  tickerOptions: TickerOption[];
}) {
  const [query, setQuery] = useState(initialSymbol);
  const [granularity, setGranularity] = useState<ArchiveGranularity>("1m");
  const [data, setData] = useState<ArchivePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadArchive(event: FormEvent) {
    event.preventDefault();
    const clean = query.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
    if (!clean) return;
    setQuery(clean);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/archive?symbol=${encodeURIComponent(clean)}&granularity=${granularity}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Archive unavailable");
      setData((await response.json()) as ArchivePayload);
    } catch {
      setData(null);
      setError("No historical candles were returned for that ticker and interval.");
    } finally {
      setLoading(false);
    }
  }

  const downloadQuery = data
    ? `symbol=${encodeURIComponent(data.requestedSymbol)}&granularity=${data.granularity}`
    : "";
  const previewRows = data ? data.rows.slice(-100).reverse() : [];

  return (
    <section className="history-page">
      <div className="history-hero">
        <div>
          <span className="eyebrow">DATA VAULT</span>
          <h1>Historical candle archive</h1>
          <p>
            Pull the most detailed free candle history available, inspect the newest records, and download the complete result.
          </p>
        </div>
        <div className="history-badges">
          <span>FREE ACCESS</span>
          <span>YAHOO FINANCE</span>
        </div>
      </div>

      <form className="archive-controls panel" onSubmit={loadArchive}>
        <div className="archive-picker-field">
          <span className="control-caption">TICKER</span>
          <SearchableTickerSelect
            value={query}
            options={tickerOptions}
            onChange={setQuery}
            ariaLabel="Choose ticker for historical data"
          />
        </div>
        <label>
          <span>DETAIL LEVEL</span>
          <select
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as ArchiveGranularity)}
            aria-label="Historical candle interval"
          >
            {ARCHIVE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.coverage}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading}>{loading ? "Loading archive…" : "Load history"}</button>
      </form>

      <div className="archive-tiers" aria-label="Available historical data detail">
        {ARCHIVE_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={granularity === option.value ? "selected" : ""}
            onClick={() => setGranularity(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.coverage}</span>
          </button>
        ))}
      </div>

      <div className="archive-caveat">
        <strong>Maximum free detail:</strong> these are OHLCV candles, not every exchange trade or bid/ask tick.
        Intraday downloads include extended-hours data when Yahoo supplies it.
      </div>

      {error && <div className="archive-error" role="status">{error}</div>}

      {data ? (
        <div className="archive-results">
          <section className="archive-summary panel">
            <div>
              <span>DATASET</span>
              <strong>{data.requestedSymbol} · {data.granularity}</strong>
              <small>{data.instrumentName}</small>
            </div>
            <div>
              <span>ROWS</span>
              <strong>{data.rowCount.toLocaleString()}</strong>
              <small>{data.coverage}</small>
            </div>
            <div>
              <span>FROM</span>
              <strong>{archiveDate(data.startTime)}</strong>
              <small>{data.exchange}</small>
            </div>
            <div>
              <span>THROUGH</span>
              <strong>{archiveDate(data.endTime)}</strong>
              <small>{data.currency}</small>
            </div>
            <div className="archive-downloads">
              <a href={`/api/archive?${downloadQuery}&format=csv`}>Download CSV</a>
              <a href={`/api/archive?${downloadQuery}&download=1`}>Download JSON</a>
            </div>
          </section>

          {data.proxy && (
            <div className="archive-proxy-note">
              XAUUSD downloads use {data.historySymbol} as the free historical candle proxy; the dashboard’s live XAUUSD quote still uses spot gold.
            </div>
          )}

          <section className="archive-table-card panel">
            <div className="archive-table-heading">
              <div>
                <span className="eyebrow">LATEST RECORDS</span>
                <h2>Newest 100 of {data.rowCount.toLocaleString()} rows</h2>
              </div>
              <span>UTC TIMESTAMPS</span>
            </div>
            <div className="archive-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Open</th>
                    <th>High</th>
                    <th>Low</th>
                    <th>Close</th>
                    <th>Adj. close</th>
                    <th>Volume</th>
                    <th>Dividend</th>
                    <th>Split</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.time}>
                      <td>{archiveDate(row.time, true)}</td>
                      <td>{archiveNumber(row.open)}</td>
                      <td>{archiveNumber(row.high)}</td>
                      <td>{archiveNumber(row.low)}</td>
                      <td>{archiveNumber(row.close)}</td>
                      <td>{archiveNumber(row.adjustedClose)}</td>
                      <td>{archiveNumber(row.volume, 0)}</td>
                      <td>{archiveNumber(row.dividend)}</td>
                      <td>{row.split || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="archive-empty panel">
          <span>↓</span>
          <h2>Choose a ticker and detail level</h2>
          <p>The full result will be downloadable; the browser only previews the latest 100 rows.</p>
        </div>
      )}

      <section className="model-database-note">
        <span className="eyebrow">SHARED MODEL DATABASE</span>
        <h2>The probability simulator uses this archive too.</h2>
        <p>
          Supported major assets use the validated Dukascopy historical pack with split-corrected daily returns and volatility regimes. Other tickers continue to use five years of Yahoo adjusted daily history.
        </p>
      </section>
    </section>
  );
}

type PortfolioHolding = {
  symbol: string;
  quantity: number;
  averageCost: number | null;
  importedName: string;
};

type PortfolioPosition = PortfolioHolding & {
  quote: Quote | null;
  marketValue: number | null;
  costValue: number | null;
  gainLoss: number | null;
  dayChange: number | null;
  weight: number;
};

const PORTFOLIO_SYMBOL_HEADERS = ["symbol", "ticker", "ticker_symbol", "instrument", "security"];
const PORTFOLIO_QUANTITY_HEADERS = ["quantity", "qty", "shares", "units", "position"];
const PORTFOLIO_AVERAGE_COST_HEADERS = [
  "average_cost",
  "avg_cost",
  "average_price",
  "cost_price",
  "purchase_price",
  "price_paid",
];
const PORTFOLIO_TOTAL_COST_HEADERS = ["total_cost", "cost_basis", "book_value"];
const PORTFOLIO_NAME_HEADERS = ["name", "company", "security_name", "description"];

function normalizePortfolioHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"") {
      if (quoted && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function portfolioNumber(value: string) {
  const normalized = value
    .trim()
    .replace(/\(([^)]+)\)/, "-$1")
    .replace(/[$€£¥,\s]/g, "")
    .replace(/^R(?=\d)/i, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findPortfolioColumn(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function parsePortfolioCsv(text: string) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one holding.");
  const headers = rows[0].map(normalizePortfolioHeader);
  const symbolColumn = findPortfolioColumn(headers, PORTFOLIO_SYMBOL_HEADERS);
  const quantityColumn = findPortfolioColumn(headers, PORTFOLIO_QUANTITY_HEADERS);
  const averageCostColumn = findPortfolioColumn(headers, PORTFOLIO_AVERAGE_COST_HEADERS);
  const totalCostColumn = findPortfolioColumn(headers, PORTFOLIO_TOTAL_COST_HEADERS);
  const nameColumn = findPortfolioColumn(headers, PORTFOLIO_NAME_HEADERS);
  if (symbolColumn < 0 || quantityColumn < 0) {
    throw new Error("Include Symbol (or Ticker) and Quantity (or Shares) columns.");
  }

  const imported = rows.slice(1).flatMap((row) => {
    const symbol = cleanTicker(row[symbolColumn] || "");
    const quantity = portfolioNumber(row[quantityColumn] || "");
    if (!symbol || quantity === null || quantity === 0) return [];
    const directAverageCost = averageCostColumn >= 0
      ? portfolioNumber(row[averageCostColumn] || "")
      : null;
    const totalCost = totalCostColumn >= 0
      ? portfolioNumber(row[totalCostColumn] || "")
      : null;
    const averageCost = directAverageCost !== null && directAverageCost >= 0
      ? directAverageCost
      : totalCost !== null && quantity !== 0
        ? Math.abs(totalCost / quantity)
        : null;
    return [{
      symbol,
      quantity,
      averageCost,
      importedName: nameColumn >= 0 ? (row[nameColumn] || "").trim().slice(0, 120) : "",
    }];
  });
  if (!imported.length) throw new Error("No valid holdings were found in the CSV.");

  const combined = new Map<string, PortfolioHolding>();
  imported.forEach((holding) => {
    const existing = combined.get(holding.symbol);
    if (!existing) {
      combined.set(holding.symbol, holding);
      return;
    }
    const quantity = existing.quantity + holding.quantity;
    if (quantity === 0) {
      combined.delete(holding.symbol);
      return;
    }
    const averageCost = existing.averageCost !== null && holding.averageCost !== null
      ? Math.abs(
          ((existing.averageCost * existing.quantity) + (holding.averageCost * holding.quantity))
          / quantity,
        )
      : null;
    combined.set(holding.symbol, {
      symbol: holding.symbol,
      quantity,
      averageCost,
      importedName: existing.importedName || holding.importedName,
    });
  });
  const holdings = [...combined.values()].slice(0, 100);
  if (!holdings.length) throw new Error("The imported positions cancel each other out.");
  return {
    holdings,
    skipped: Math.max(0, rows.length - 1 - imported.length),
    truncated: combined.size > holdings.length,
  };
}

function PortfolioPanel({
  onSelectStock,
}: {
  onSelectStock: (symbol: string) => void;
}) {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [portfolioQuotes, setPortfolioQuotes] = useState<Quote[]>([]);
  const [fileName, setFileName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const portfolioQuoteInFlightRef = useRef(false);

  const loadPortfolioQuotes = useCallback(async (
    nextHoldings: PortfolioHolding[],
    quiet = false,
  ) => {
    const symbols = nextHoldings.map((holding) => holding.symbol);
    if (!symbols.length) return;
    if (quiet && portfolioQuoteInFlightRef.current) return;
    portfolioQuoteInFlightRef.current = true;
    if (!quiet) setLoading(true);
    try {
      const batches = Array.from(
        { length: Math.ceil(symbols.length / 24) },
        (_, index) => symbols.slice(index * 24, (index + 1) * 24),
      );
      const payloads = await Promise.all(batches.map(async (batch) => {
        const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(batch.join(","))}`, {
          cache: "no-store",
        });
        if (!response.ok) return [] as Quote[];
        const payload = await response.json() as { quotes?: Quote[] };
        return Array.isArray(payload.quotes) ? payload.quotes : [];
      }));
      const nextQuotes = payloads.flat();
      if (!nextQuotes.length) throw new Error("No portfolio quotes returned");
      setPortfolioQuotes(nextQuotes);
      setLastUpdated(new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }));
      setError(null);
    } catch {
      if (!quiet) setError("Live prices are temporarily unavailable for this portfolio.");
    } finally {
      portfolioQuoteInFlightRef.current = false;
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!holdings.length) return;
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPortfolioQuotes(holdings, true);
    }, 5_000);
    return () => window.clearInterval(refresh);
  }, [holdings, loadPortfolioQuotes]);

  async function importPortfolioFile(file: File) {
    setDragging(false);
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("The CSV must be smaller than 1 MB.");
      return;
    }
    try {
      const parsed = parsePortfolioCsv(await file.text());
      setHoldings(parsed.holdings);
      setPortfolioQuotes([]);
      setFileName(file.name);
      setImportMessage([
        `${parsed.holdings.length} position${parsed.holdings.length === 1 ? "" : "s"} imported`,
        parsed.skipped ? `${parsed.skipped} invalid row${parsed.skipped === 1 ? "" : "s"} skipped` : "",
        parsed.truncated ? "limited to 100 positions" : "",
      ].filter(Boolean).join(" · "));
      await loadPortfolioQuotes(parsed.holdings);
    } catch (importError: unknown) {
      setError(importError instanceof Error ? importError.message : "The portfolio could not be imported.");
    }
  }

  function downloadPortfolioTemplate() {
    const template = [
      "symbol,quantity,average_cost,name",
      "AAPL,25,190.50,Apple Inc.",
      "MSFT,12,410.00,Microsoft Corp.",
      "NVDA,18,120.00,NVIDIA Corp.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ledger-portfolio-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const quoteBySymbol = useMemo(
    () => new Map(portfolioQuotes.map((quote) => [quote.symbol, quote])),
    [portfolioQuotes],
  );
  const positions = useMemo(() => {
    const preliminary = holdings.map((holding) => {
      const quote = quoteBySymbol.get(holding.symbol) || null;
      const marketValue = quote ? holding.quantity * quote.price : null;
      const costValue = holding.averageCost !== null
        ? holding.quantity * holding.averageCost
        : null;
      return {
        ...holding,
        quote,
        marketValue,
        costValue,
        gainLoss: marketValue !== null && costValue !== null ? marketValue - costValue : null,
        dayChange: quote ? holding.quantity * quote.change : null,
        weight: 0,
      };
    });
    const grossByCurrency = new Map<string, number>();
    preliminary.forEach((position) => {
      if (!position.quote || position.marketValue === null) return;
      grossByCurrency.set(
        position.quote.currency,
        (grossByCurrency.get(position.quote.currency) || 0) + Math.abs(position.marketValue),
      );
    });
    return preliminary.map((position) => ({
      ...position,
      weight: position.quote && position.marketValue !== null
        ? Math.abs(position.marketValue) / (grossByCurrency.get(position.quote.currency) || 1)
        : 0,
    })).sort((left, right) => Math.abs(right.marketValue || 0) - Math.abs(left.marketValue || 0));
  }, [holdings, quoteBySymbol]);

  const currencySummaries = useMemo(() => {
    const summaries = new Map<string, {
      currency: string;
      value: number;
      cost: number;
      dayChange: number;
      gainLoss: number;
      costCoverage: number;
      positions: number;
    }>();
    positions.forEach((position) => {
      if (!position.quote || position.marketValue === null) return;
      const current = summaries.get(position.quote.currency) || {
        currency: position.quote.currency,
        value: 0,
        cost: 0,
        dayChange: 0,
        gainLoss: 0,
        costCoverage: 0,
        positions: 0,
      };
      current.value += position.marketValue;
      current.dayChange += position.dayChange || 0;
      current.positions += 1;
      if (position.costValue !== null && position.gainLoss !== null) {
        current.cost += position.costValue;
        current.gainLoss += position.gainLoss;
        current.costCoverage += 1;
      }
      summaries.set(position.quote.currency, current);
    });
    return [...summaries.values()].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  }, [positions]);
  const primarySummary = currencySummaries[0] || null;
  const isMultiCurrency = currencySummaries.length > 1;
  const pricedCount = positions.filter((position) => position.quote).length;

  if (!holdings.length) {
    return (
      <section className="portfolio-page">
        <div className="portfolio-hero">
          <div>
            <span className="eyebrow">PRIVATE PORTFOLIO LAB</span>
            <h1>Bring your holdings into Ledger.</h1>
            <p>
              Upload a CSV to calculate live values, allocation weights, daily movement, and cost-basis performance.
            </p>
          </div>
          <div className="portfolio-privacy">
            <span>LOCAL ONLY</span>
            <strong>Your file never leaves this browser.</strong>
            <small>Nothing is saved after the page is refreshed.</small>
          </div>
        </div>
        <label
          className={`portfolio-dropzone panel ${dragging ? "dragging" : ""}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void importPortfolioFile(file);
          }}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPortfolioFile(file);
              event.target.value = "";
            }}
          />
          <span>↑</span>
          <div>
            <strong>Drop your portfolio CSV here</strong>
            <small>or click to choose a file · maximum 100 positions / 1 MB</small>
          </div>
          <i>Choose CSV</i>
        </label>
        {error && <div className="portfolio-error" role="status">{error}</div>}
        <section className="portfolio-format panel">
          <div>
            <span className="eyebrow">ACCEPTED COLUMNS</span>
            <h2>Simple, broker-friendly format</h2>
            <p>
              Required: <b>Symbol</b> and <b>Quantity</b>. Optional: <b>Average Cost</b>,
              <b>Total Cost / Cost Basis</b>, and <b>Name</b>. Common alternatives such as
              Ticker, Shares, Units, Avg Cost, and Book Value are recognized automatically.
            </p>
          </div>
          <pre>symbol,quantity,average_cost{"\n"}AAPL,25,190.50{"\n"}MSFT,12,410.00</pre>
          <button type="button" onClick={downloadPortfolioTemplate}>Download template</button>
        </section>
      </section>
    );
  }

  return (
    <section className="portfolio-page">
      <div className="portfolio-dashboard-header">
        <div>
          <span className="eyebrow">PRIVATE PORTFOLIO LAB</span>
          <h1>{fileName}</h1>
          <p>{importMessage} · prices refresh every 5 seconds</p>
        </div>
        <div className="portfolio-header-actions">
          <label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importPortfolioFile(file);
                event.target.value = "";
              }}
            />
            Upload new CSV
          </label>
          <button
            type="button"
            onClick={() => {
              setHoldings([]);
              setPortfolioQuotes([]);
              setFileName("");
              setImportMessage("");
              setError(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {error && <div className="portfolio-error" role="status">{error}</div>}

      <div className="portfolio-summary">
        <div>
          <span>LIVE VALUE</span>
          <strong>
            {loading
              ? "Loading…"
              : isMultiCurrency
                ? "MULTI"
                : primarySummary
                  ? formatMoney(primarySummary.value, primarySummary.currency)
                  : "—"}
          </strong>
          <small>{isMultiCurrency ? `${currencySummaries.length} currency buckets` : primarySummary?.currency || "Waiting for quotes"}</small>
        </div>
        <div>
          <span>DAY MOVE</span>
          <strong className={(primarySummary?.dayChange || 0) >= 0 ? "up-text" : "down-text"}>
            {isMultiCurrency
              ? "See below"
              : primarySummary
                ? formatMoney(primarySummary.dayChange, primarySummary.currency)
                : "—"}
          </strong>
          <small>Based on previous close</small>
        </div>
        <div>
          <span>TOTAL GAIN / LOSS</span>
          <strong className={(primarySummary?.gainLoss || 0) >= 0 ? "up-text" : "down-text"}>
            {isMultiCurrency
              ? "See below"
              : primarySummary && primarySummary.costCoverage
                ? formatMoney(primarySummary.gainLoss, primarySummary.currency)
                : "—"}
          </strong>
          <small>{primarySummary?.costCoverage || 0} cost-basis positions</small>
        </div>
        <div>
          <span>LIVE COVERAGE</span>
          <strong>{pricedCount} / {holdings.length}</strong>
          <small>Updated {lastUpdated || "connecting…"}</small>
        </div>
      </div>

      {currencySummaries.length > 1 && (
        <div className="portfolio-currencies">
          {currencySummaries.map((summary) => (
            <div key={summary.currency}>
              <span>{summary.currency}</span>
              <strong>{formatMoney(summary.value, summary.currency)}</strong>
              <small className={summary.dayChange >= 0 ? "up-text" : "down-text"}>
                Today {summary.dayChange >= 0 ? "+" : ""}{formatMoney(summary.dayChange, summary.currency)}
              </small>
              <small className={summary.gainLoss >= 0 ? "up-text" : "down-text"}>
                Gain {summary.costCoverage ? formatMoney(summary.gainLoss, summary.currency) : "—"}
              </small>
            </div>
          ))}
        </div>
      )}

      <section className="portfolio-table-panel panel">
        <div className="portfolio-table-heading">
          <div>
            <span className="eyebrow">LIVE HOLDINGS</span>
            <h2>Positions and allocation</h2>
          </div>
          <span>{loading ? "Loading prices…" : `${pricedCount} priced · ${holdings.length - pricedCount} unavailable`}</span>
        </div>
        <div className="portfolio-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Quantity</th>
                <th>Live price</th>
                <th>Market value</th>
                <th>Day move</th>
                <th>Avg cost</th>
                <th>Gain / loss</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.symbol}>
                  <td>
                    <button type="button" onClick={() => onSelectStock(position.symbol)}>
                      <span>{position.symbol.slice(0, 1)}</span>
                      <div>
                        <strong>{position.symbol}</strong>
                        <small>{position.quote?.name || position.importedName || "Quote unavailable"}</small>
                      </div>
                    </button>
                  </td>
                  <td>{position.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
                  <td>{position.quote ? formatMoney(position.quote.price, position.quote.currency) : "—"}</td>
                  <td><strong>{position.quote && position.marketValue !== null ? formatMoney(position.marketValue, position.quote.currency) : "—"}</strong></td>
                  <td className={(position.dayChange || 0) >= 0 ? "up-text" : "down-text"}>
                    {position.quote && position.dayChange !== null
                      ? formatMoney(position.dayChange, position.quote.currency)
                      : "—"}
                  </td>
                  <td>{position.quote && position.averageCost !== null ? formatMoney(position.averageCost, position.quote.currency) : "—"}</td>
                  <td className={(position.gainLoss || 0) >= 0 ? "up-text" : "down-text"}>
                    {position.quote && position.gainLoss !== null
                      ? formatMoney(position.gainLoss, position.quote.currency)
                      : "—"}
                  </td>
                  <td>
                    <div className="portfolio-weight">
                      <span><i style={{ width: `${Math.min(100, position.weight * 100)}%` }} /></span>
                      <strong>{(position.weight * 100).toFixed(1)}%</strong>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="portfolio-note">
        Your CSV is processed only in this browser and is not uploaded or saved. Prices come from the dashboard&apos;s
        existing Yahoo Finance quote service. Values remain in each security&apos;s native currency; no foreign-exchange
        conversion is applied. Missing cost basis leaves gain/loss blank. Informational only, not investment advice.
      </p>
    </section>
  );
}

type PaperSide = "long" | "short";
type PaperOrderType = "market" | "limit" | "stop";
type PaperCloseReason = "Take profit" | "Stop loss" | "Liquidation" | "Manual close";

type PaperPosition = {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  side: PaperSide;
  quantity: number;
  leverage: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  openedAt: number;
  note?: string;
};

type PaperPendingOrder = {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  side: PaperSide;
  orderType: Exclude<PaperOrderType, "market">;
  quantity: number;
  leverage: number;
  triggerPrice: number;
  takeProfit: number;
  stopLoss: number;
  createdAt: number;
  note?: string;
};

type PaperClosedTrade = PaperPosition & {
  exitPrice: number;
  closedAt: number;
  closeReason: PaperCloseReason;
  pnl: number;
};

type PaperAccount = {
  positions: PaperPosition[];
  pendingOrders: PaperPendingOrder[];
  history: PaperClosedTrade[];
};

type PaperChartOverlay = {
  side: PaperSide;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  quantity: number;
  leverage: number;
  liquidationPrice: number;
  status: "planned" | "open";
  pnl: number;
};

const PAPER_ACCOUNT_STORAGE_KEY = "ledger-paper-trading-v1";
const PAPER_STARTING_BALANCE = 100_000;
const PAPER_MAX_POSITIONS = 24;
const PAPER_MAX_LEVERAGE = 50;
const PAPER_MAINTENANCE_MARGIN_RATE = 0.005;
const EMPTY_PAPER_ACCOUNT: PaperAccount = {
  positions: [],
  pendingOrders: [],
  history: [],
};

function paperId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function paperPrice(value: number) {
  if (!Number.isFinite(value)) return 0;
  const digits = Math.abs(value) < 10 ? 4 : Math.abs(value) < 100 ? 3 : 2;
  return Number(value.toFixed(digits));
}

function paperPnl(position: PaperPosition, price: number) {
  const direction = position.side === "long" ? 1 : -1;
  return (price - position.entryPrice) * position.quantity * direction;
}

function paperLeverage(value: number | undefined) {
  return Math.max(1, Math.min(PAPER_MAX_LEVERAGE, Math.round(value || 1)));
}

function paperPositionMargin(position: Pick<PaperPosition, "entryPrice" | "quantity" | "leverage">) {
  return Math.abs(position.entryPrice * position.quantity) / paperLeverage(position.leverage);
}

function paperLiquidationPrice(position: Pick<PaperPosition, "side" | "entryPrice" | "leverage">) {
  const leverage = paperLeverage(position.leverage);
  const lossFraction = Math.max(0, (1 / leverage) - PAPER_MAINTENANCE_MARGIN_RATE);
  return paperPrice(
    position.side === "long"
      ? Math.max(0.0001, position.entryPrice * (1 - lossFraction))
      : position.entryPrice * (1 + lossFraction),
  );
}

function paperPercent(position: PaperPosition, price: number) {
  if (!position.entryPrice) return 0;
  const direction = position.side === "long" ? 1 : -1;
  return ((price - position.entryPrice) / position.entryPrice) * 100 * direction;
}

type TradingCostProfile = {
  estimatedOneWayCrossingCostBps: number;
};

const PACKED_TRADING_COSTS = tradingCostProfiles.profiles as Record<string, TradingCostProfile>;

function paperExecutionCostBps(symbol: string) {
  const normalized = symbol === "GOOGL" ? "GOOG" : symbol === "BRK.B" ? "BRK-B" : symbol;
  const packedCrossingCost = PACKED_TRADING_COSTS[normalized]?.estimatedOneWayCrossingCostBps;
  if (!Number.isFinite(packedCrossingCost)) return 1.5;
  return Math.min(12, Math.max(1.5, packedCrossingCost + 0.75));
}

function paperEntryFill(price: number, side: PaperSide, symbol: string) {
  const cost = paperExecutionCostBps(symbol) / 10_000;
  return paperPrice(price * (side === "long" ? 1 + cost : 1 - cost));
}

function paperExitFill(price: number, side: PaperSide, symbol: string) {
  const cost = paperExecutionCostBps(symbol) / 10_000;
  return paperPrice(price * (side === "long" ? 1 - cost : 1 + cost));
}

function PaperTradingChart({
  points,
  range,
  currency,
  currentPrice,
  overlay,
  onMoveLevel,
}: {
  points: MarketDetail["points"];
  range: RangeKey;
  currency: string;
  currentPrice: number;
  overlay: PaperChartOverlay | null;
  onMoveLevel: (level: "takeProfit" | "stopLoss", price: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const draggingRef = useRef<"takeProfit" | "stopLoss" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;

    const frame = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { top: 24, right: 92, bottom: 34, left: 12 };
      const chartWidth = Math.max(1, width - padding.left - padding.right);
      const chartHeight = Math.max(1, height - padding.top - padding.bottom);
      const plotRight = padding.left + chartWidth;
      const values = [
        ...points.map((point) => point.value),
        currentPrice,
        ...(overlay
          ? [
              overlay.entry,
              overlay.takeProfit,
              overlay.stopLoss,
              ...(overlay.leverage > 1 ? [overlay.liquidationPrice] : []),
            ]
          : []),
      ].filter((value) => Number.isFinite(value) && value > 0);
      const rawMin = Math.min(...values);
      const rawMax = Math.max(...values);
      const spread = Math.max(rawMax - rawMin, rawMax * 0.012);
      const min = rawMin - spread * 0.12;
      const max = rawMax + spread * 0.12;
      const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * chartWidth;
      const y = (value: number) => padding.top + ((max - value) / (max - min)) * chartHeight;
      const priceFromY = (pointerY: number) => (
        max - ((pointerY - padding.top) / chartHeight) * (max - min)
      );

      context.fillStyle = "#111510";
      context.fillRect(0, 0, width, height);
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      for (let row = 0; row < 5; row += 1) {
        const rowY = padding.top + (row / 4) * chartHeight;
        context.strokeStyle = "rgba(255,255,255,0.075)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, rowY + 0.5);
        context.lineTo(plotRight, rowY + 0.5);
        context.stroke();
        context.fillStyle = "rgba(255,255,255,0.46)";
        context.textAlign = "left";
        context.textBaseline = row === 0 ? "top" : row === 4 ? "bottom" : "middle";
        context.fillText(
          formatAxisPrice(max - (row / 4) * (max - min), currency),
          plotRight + 10,
          rowY,
        );
      }

      for (let column = 0; column < 5; column += 1) {
        const columnX = padding.left + (column / 4) * chartWidth;
        context.strokeStyle = "rgba(255,255,255,0.045)";
        context.beginPath();
        context.moveTo(columnX + 0.5, padding.top);
        context.lineTo(columnX + 0.5, padding.top + chartHeight);
        context.stroke();
      }

      const gradient = context.createLinearGradient(0, padding.top, 0, height);
      gradient.addColorStop(0, "rgba(173,255,47,0.16)");
      gradient.addColorStop(1, "rgba(173,255,47,0)");
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.lineTo(x(points.length - 1), padding.top + chartHeight);
      context.lineTo(x(0), padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.strokeStyle = "#d9ff9c";
      context.lineWidth = 2;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();

      const currentY = y(currentPrice);
      context.save();
      context.setLineDash([3, 4]);
      context.strokeStyle = "rgba(173, 255, 47, 0.52)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, currentY);
      context.lineTo(plotRight, currentY);
      context.stroke();
      context.setLineDash([]);
      context.font = "800 9px ui-monospace, SFMono-Regular, Menlo, monospace";
      const lastPriceLabel = `LAST ${formatAxisPrice(currentPrice, currency)}`;
      const lastPriceWidth = Math.min(88, context.measureText(lastPriceLabel).width + 12);
      context.fillStyle = "#adff2f";
      context.fillRect(plotRight + 4, currentY - 10, lastPriceWidth, 20);
      context.fillStyle = "#10140f";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(lastPriceLabel, plotRight + 4 + lastPriceWidth / 2, currentY);
      context.restore();

      if (overlay) {
        const zoneLeft = padding.left + chartWidth * 0.48;
        const entryY = y(overlay.entry);
        const targetY = y(overlay.takeProfit);
        const stopY = y(overlay.stopLoss);
        const targetTop = Math.min(entryY, targetY);
        const targetHeight = Math.max(2, Math.abs(entryY - targetY));
        const stopTop = Math.min(entryY, stopY);
        const stopHeight = Math.max(2, Math.abs(entryY - stopY));
        const targetPnl = Math.abs(overlay.takeProfit - overlay.entry) * overlay.quantity;
        const riskPnl = Math.abs(overlay.entry - overlay.stopLoss) * overlay.quantity;
        const riskReward = riskPnl > 0 ? targetPnl / riskPnl : 0;

        context.fillStyle = "rgba(35, 174, 112, 0.23)";
        context.fillRect(zoneLeft, targetTop, plotRight - zoneLeft, targetHeight);
        context.fillStyle = "rgba(242, 79, 79, 0.23)";
        context.fillRect(zoneLeft, stopTop, plotRight - zoneLeft, stopHeight);

        const drawLevel = (
          price: number,
          color: string,
          dash: number[],
          label: string,
          level: "takeProfit" | "stopLoss" | "entry" | "liquidation",
        ) => {
          const levelY = y(price);
          context.save();
          context.setLineDash(dash);
          context.strokeStyle = color;
          context.lineWidth = level === "entry" ? 1.5 : 1.2;
          context.beginPath();
          context.moveTo(zoneLeft, levelY);
          context.lineTo(plotRight, levelY);
          context.stroke();
          context.setLineDash([]);

          if (level === "takeProfit" || level === "stopLoss") {
            context.beginPath();
            context.arc(zoneLeft, levelY, 5, 0, Math.PI * 2);
            context.fillStyle = "#111510";
            context.fill();
            context.strokeStyle = color;
            context.lineWidth = 2;
            context.stroke();
          }

          const axisLabel = `${label} ${formatAxisPrice(price, currency)}`;
          context.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
          const labelWidth = Math.min(88, context.measureText(axisLabel).width + 12);
          context.fillStyle = color;
          context.fillRect(plotRight + 4, levelY - 10, labelWidth, 20);
          context.fillStyle = level === "entry" ? "#10140f" : "#ffffff";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(axisLabel, plotRight + 4 + labelWidth / 2, levelY);
          context.restore();
        };

        drawLevel(overlay.takeProfit, "#20ad70", [], "TP", "takeProfit");
        drawLevel(overlay.entry, "#f2c84b", [6, 4], "ENTRY", "entry");
        drawLevel(overlay.stopLoss, "#ef5656", [], "SL", "stopLoss");
        if (overlay.leverage > 1) {
          drawLevel(overlay.liquidationPrice, "#bb78ff", [3, 4], "LIQ", "liquidation");
        }

        const targetLabelY = targetTop + Math.max(16, targetHeight / 2);
        const stopLabelY = stopTop + Math.max(16, stopHeight / 2);
        context.textAlign = "left";
        context.fillStyle = "#8ff1ba";
        context.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(
          `TARGET  +${formatMoney(targetPnl, currency)}  ·  ${riskReward.toFixed(2)}R`,
          zoneLeft + 13,
          Math.min(targetTop + targetHeight - 6, targetLabelY),
        );
        context.fillStyle = "#ff9797";
        context.fillText(
          `RISK  −${formatMoney(riskPnl, currency)}`,
          zoneLeft + 13,
          Math.min(stopTop + stopHeight - 6, stopLabelY),
        );

        const boxWidth = 236;
        const boxHeight = 48;
        const boxX = Math.min(plotRight - boxWidth - 8, zoneLeft + 18);
        const boxY = Math.max(padding.top + 8, Math.min(
          padding.top + chartHeight - boxHeight - 8,
          entryY - boxHeight / 2,
        ));
        context.fillStyle = "rgba(16,20,15,0.96)";
        context.strokeStyle = overlay.pnl >= 0 ? "#adff2f" : "#ff695e";
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(boxX, boxY, boxWidth, boxHeight, 5);
        context.fill();
        context.stroke();
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.fillStyle = overlay.pnl >= 0 ? "#adff2f" : "#ff8279";
        context.font = "800 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(
          overlay.status === "open"
            ? `OPEN P&L  ${overlay.pnl >= 0 ? "+" : ""}${formatMoney(overlay.pnl, currency)}`
            : "PLANNED POSITION",
          boxX + 11,
          boxY + 19,
        );
        context.fillStyle = "rgba(255,255,255,0.62)";
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(
          `${overlay.side.toUpperCase()} · ${overlay.leverage}× · QTY ${overlay.quantity.toLocaleString()} · R:R ${riskReward.toFixed(2)}`,
          boxX + 11,
          boxY + 37,
        );

        const badgeX = zoneLeft - 27;
        context.fillStyle = overlay.side === "long" ? "#22b573" : "#ef5656";
        context.beginPath();
        context.roundRect(badgeX, entryY - 12, 25, 24, 4);
        context.fill();
        context.fillStyle = "#fff";
        context.font = "800 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(overlay.side === "long" ? "B" : "S", badgeX + 12.5, entryY);
      }

      const lastPoint = points[points.length - 1];
      context.beginPath();
      context.arc(x(points.length - 1), y(lastPoint.value), 4, 0, Math.PI * 2);
      context.fillStyle = "#adff2f";
      context.fill();

      const hoverIndex = hoverIndexRef.current;
      if (hoverIndex !== null && !draggingRef.current) {
        const point = points[Math.min(points.length - 1, hoverIndex)];
        const hoverX = x(Math.min(points.length - 1, hoverIndex));
        const hoverY = y(point.value);
        context.save();
        context.setLineDash([4, 4]);
        context.strokeStyle = "rgba(255,255,255,0.38)";
        context.beginPath();
        context.moveTo(hoverX, padding.top);
        context.lineTo(hoverX, padding.top + chartHeight);
        context.stroke();
        context.restore();
        context.beginPath();
        context.arc(hoverX, hoverY, 4, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.fill();
      }

      const lastIndex = points.length - 1;
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = "rgba(255,255,255,0.48)";
      [0, Math.floor(lastIndex / 2), lastIndex].forEach((pointIndex, labelIndex) => {
        context.textAlign = labelIndex === 0 ? "left" : labelIndex === 2 ? "right" : "center";
        context.textBaseline = "bottom";
        context.fillText(formatPointTime(points[pointIndex].time, range), x(pointIndex), height - 4);
      });

      return { padding, chartWidth, chartHeight, min, max, y, priceFromY };
    };

    const pointerDown = (event: PointerEvent) => {
      if (!overlay) return;
      const rect = canvas.getBoundingClientRect();
      const geometry = frame();
      if (!geometry) return;
      const pointerY = event.clientY - rect.top;
      const targetDistance = Math.abs(pointerY - geometry.y(overlay.takeProfit));
      const stopDistance = Math.abs(pointerY - geometry.y(overlay.stopLoss));
      if (Math.min(targetDistance, stopDistance) > 15) return;
      draggingRef.current = targetDistance <= stopDistance ? "takeProfit" : "stopLoss";
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const geometry = frame();
      if (!geometry) return;
      if (draggingRef.current) {
        const nextPrice = paperPrice(Math.max(
          0.0001,
          geometry.priceFromY(Math.max(
            geometry.padding.top,
            Math.min(geometry.padding.top + geometry.chartHeight, event.clientY - rect.top),
          )),
        ));
        onMoveLevel(draggingRef.current, nextPrice);
        return;
      }
      const pointerX = Math.max(0, Math.min(
        geometry.chartWidth,
        event.clientX - rect.left - geometry.padding.left,
      ));
      hoverIndexRef.current = Math.round((pointerX / geometry.chartWidth) * (points.length - 1));
      frame();
    };
    const pointerUp = (event: PointerEvent) => {
      if (draggingRef.current && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      draggingRef.current = null;
      frame();
    };
    const pointerLeave = () => {
      if (draggingRef.current) return;
      hoverIndexRef.current = null;
      frame();
    };

    frame();
    const observer = new ResizeObserver(frame);
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
    };
  }, [currency, currentPrice, onMoveLevel, overlay, points, range]);

  return (
    <canvas
      ref={canvasRef}
      className="paper-chart"
      aria-label="Paper-trading chart with draggable take-profit and stop-loss levels"
    />
  );
}

function PaperTradingPanel({
  detail,
  loading,
  symbol,
  range,
  tickerOptions,
  onSelectTicker,
  onRangeChange,
}: {
  detail: MarketDetail | null;
  loading: boolean;
  symbol: string;
  range: RangeKey;
  tickerOptions: TickerOption[];
  onSelectTicker: (symbol: string) => void;
  onRangeChange: (range: RangeKey) => void;
}) {
  const [account, setAccount] = useState<PaperAccount>(EMPTY_PAPER_ACCOUNT);
  const [hydrated, setHydrated] = useState(false);
  const [side, setSide] = useState<PaperSide>("long");
  const [orderType, setOrderType] = useState<PaperOrderType>("market");
  const [quantity, setQuantity] = useState("10");
  const [orderPrice, setOrderPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");
  const [leverage, setLeverage] = useState("1");
  const [tradeNote, setTradeNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ledgerTab, setLedgerTab] = useState<"positions" | "orders" | "history">("positions");
  const [positionQuotes, setPositionQuotes] = useState<Quote[]>([]);
  const quoteRefreshInFlightRef = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PaperAccount>;
        setAccount({
          positions: Array.isArray(parsed.positions)
            ? parsed.positions.slice(0, PAPER_MAX_POSITIONS).map((position) => ({
                ...position,
                leverage: paperLeverage(position.leverage),
              }))
            : [],
          pendingOrders: Array.isArray(parsed.pendingOrders)
            ? parsed.pendingOrders.slice(0, PAPER_MAX_POSITIONS).map((order) => ({
                ...order,
                leverage: paperLeverage(order.leverage),
              }))
            : [],
          history: Array.isArray(parsed.history)
            ? parsed.history.slice(0, 250).map((trade) => ({
                ...trade,
                leverage: paperLeverage(trade.leverage),
              }))
            : [],
        });
      }
    } catch {
      window.localStorage.removeItem(PAPER_ACCOUNT_STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PAPER_ACCOUNT_STORAGE_KEY, JSON.stringify(account));
  }, [account, hydrated]);

  useEffect(() => {
    if (!detail) return;
    const entry = paperPrice(detail.price);
    setOrderPrice(String(entry));
    setTakeProfit(String(paperPrice(entry * (side === "long" ? 1.03 : 0.97))));
    setStopLoss(String(paperPrice(entry * (side === "long" ? 0.985 : 1.015))));
    setReviewing(false);
    setTicketError(null);
  }, [detail?.symbol, side]);

  const trackedSymbols = useMemo(
    () => [...new Set([
      ...account.positions.map((position) => position.symbol),
      ...account.pendingOrders.map((order) => order.symbol),
    ])].slice(0, PAPER_MAX_POSITIONS),
    [account.pendingOrders, account.positions],
  );

  const refreshPositionQuotes = useCallback(async () => {
    if (!trackedSymbols.length || quoteRefreshInFlightRef.current) return;
    quoteRefreshInFlightRef.current = true;
    try {
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(trackedSymbols.join(","))}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Paper quote refresh failed");
      const payload = await response.json() as { quotes?: Quote[] };
      if (Array.isArray(payload.quotes)) setPositionQuotes(payload.quotes);
    } catch {
      // Keep the last verified prices; the live status on the page remains visible.
    } finally {
      quoteRefreshInFlightRef.current = false;
    }
  }, [trackedSymbols]);

  useEffect(() => {
    void refreshPositionQuotes();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPositionQuotes();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshPositionQuotes]);

  const quoteBySymbol = useMemo(() => {
    const map = new Map(positionQuotes.map((quote) => [quote.symbol, quote]));
    if (detail) {
      map.set(detail.symbol, detail);
    }
    return map;
  }, [detail, positionQuotes]);

  useEffect(() => {
    if (!hydrated || !quoteBySymbol.size) return;
    setAccount((current) => {
      let changed = false;
      const nextPositions = [...current.positions];
      const nextPending: PaperPendingOrder[] = [];

      current.pendingOrders.forEach((order) => {
        const quote = quoteBySymbol.get(order.symbol);
        if (!quote) {
          nextPending.push(order);
          return;
        }
        const triggered = order.side === "long"
          ? order.orderType === "limit" ? quote.price <= order.triggerPrice : quote.price >= order.triggerPrice
          : order.orderType === "limit" ? quote.price >= order.triggerPrice : quote.price <= order.triggerPrice;
        if (!triggered || nextPositions.length >= PAPER_MAX_POSITIONS) {
          nextPending.push(order);
          return;
        }
        const baseFill = order.orderType === "limit"
          ? order.side === "long"
            ? Math.min(quote.price, order.triggerPrice)
            : Math.max(quote.price, order.triggerPrice)
          : order.triggerPrice;
        nextPositions.push({
          id: paperId("position"),
          symbol: order.symbol,
          name: order.name,
          currency: order.currency,
          side: order.side,
          quantity: order.quantity,
          leverage: paperLeverage(order.leverage),
          entryPrice: order.orderType === "limit"
            ? paperPrice(baseFill)
            : paperEntryFill(baseFill, order.side, order.symbol),
          takeProfit: order.takeProfit,
          stopLoss: order.stopLoss,
          openedAt: Date.now(),
          note: order.note,
        });
        changed = true;
      });

      const stillOpen: PaperPosition[] = [];
      const newlyClosed: PaperClosedTrade[] = [];
      nextPositions.forEach((position) => {
        const quote = quoteBySymbol.get(position.symbol);
        if (!quote) {
          stillOpen.push(position);
          return;
        }
        const takeProfitHit = position.side === "long"
          ? quote.price >= position.takeProfit
          : quote.price <= position.takeProfit;
        const stopLossHit = position.side === "long"
          ? quote.price <= position.stopLoss
          : quote.price >= position.stopLoss;
        const liquidationPrice = paperLiquidationPrice(position);
        const liquidationHit = paperLeverage(position.leverage) > 1 && (
          position.side === "long"
            ? quote.price <= liquidationPrice
            : quote.price >= liquidationPrice
        );
        if (!takeProfitHit && !stopLossHit && !liquidationHit) {
          stillOpen.push(position);
          return;
        }
        const closeReason: PaperCloseReason = liquidationHit
          ? "Liquidation"
          : takeProfitHit
            ? "Take profit"
            : "Stop loss";
        const requestedExit = liquidationHit
          ? quote.price
          : takeProfitHit
            ? position.takeProfit
            : position.stopLoss;
        const exitPrice = takeProfitHit && !liquidationHit
          ? paperPrice(requestedExit)
          : paperExitFill(requestedExit, position.side, position.symbol);
        newlyClosed.push({
          ...position,
          exitPrice,
          closedAt: Date.now(),
          closeReason,
          pnl: paperPnl(position, exitPrice),
        });
        changed = true;
      });

      if (!changed) return current;
      return {
        positions: stillOpen,
        pendingOrders: nextPending,
        history: [...newlyClosed, ...current.history].slice(0, 250),
      };
    });
  }, [hydrated, quoteBySymbol]);

  const selectedCurrency = detail?.currency || "USD";
  const selectedPositions = account.positions.filter((position) => position.currency === selectedCurrency);
  const selectedPendingOrders = account.pendingOrders.filter((order) => order.currency === selectedCurrency);
  const selectedHistory = account.history.filter((trade) => trade.currency === selectedCurrency);
  const numericLeverage = paperLeverage(Number(leverage));
  const realizedPnl = selectedHistory.reduce((sum, trade) => sum + trade.pnl, 0);
  const unrealizedPnl = selectedPositions.reduce((sum, position) => {
    const quote = quoteBySymbol.get(position.symbol);
    return sum + (quote ? paperPnl(position, quote.price) : 0);
  }, 0);
  const usedMargin = selectedPositions.reduce(
    (sum, position) => sum + paperPositionMargin(position),
    0,
  );
  const reservedMargin = selectedPendingOrders.reduce(
    (sum, order) => sum + (
      Math.abs(order.triggerPrice * order.quantity) / paperLeverage(order.leverage)
    ),
    0,
  );
  const equity = PAPER_STARTING_BALANCE + realizedPnl + unrealizedPnl;
  const freeMargin = Math.max(0, equity - usedMargin - reservedMargin);
  const buyingPower = freeMargin * numericLeverage;
  const wins = selectedHistory.filter((trade) => trade.pnl > 0).length;
  const winRate = selectedHistory.length ? (wins / selectedHistory.length) * 100 : 0;

  const numericQuantity = Math.max(0, Number(quantity) || 0);
  const numericOrderPrice = Number(orderPrice) || detail?.price || 0;
  const executionCostBps = paperExecutionCostBps(symbol);
  const plannedEntry = orderType === "market"
    ? paperEntryFill(detail?.price || numericOrderPrice, side, symbol)
    : numericOrderPrice;
  const numericTakeProfit = Number(takeProfit) || 0;
  const numericStopLoss = Number(stopLoss) || 0;
  const plannedTarget = Math.abs(numericTakeProfit - plannedEntry) * numericQuantity;
  const plannedRisk = Math.abs(plannedEntry - numericStopLoss) * numericQuantity;
  const plannedRiskReward = plannedRisk ? plannedTarget / plannedRisk : 0;
  const plannedNotional = plannedEntry * numericQuantity;
  const plannedMargin = plannedNotional / numericLeverage;
  const plannedLiquidationPrice = plannedEntry > 0
    ? paperLiquidationPrice({ side, entryPrice: plannedEntry, leverage: numericLeverage })
    : 0;
  const activeSymbolPositions = account.positions.filter((position) => position.symbol === symbol);
  const activePosition = activeSymbolPositions[activeSymbolPositions.length - 1] || null;
  const activePositionPrice = detail?.price || activePosition?.entryPrice || 0;
  const chartOverlay: PaperChartOverlay | null = activePosition
    ? {
        side: activePosition.side,
        entry: activePosition.entryPrice,
        takeProfit: activePosition.takeProfit,
        stopLoss: activePosition.stopLoss,
        quantity: activePosition.quantity,
        leverage: paperLeverage(activePosition.leverage),
        liquidationPrice: paperLiquidationPrice(activePosition),
        status: "open",
        pnl: paperPnl(activePosition, activePositionPrice),
      }
    : plannedEntry > 0 && numericTakeProfit > 0 && numericStopLoss > 0 && numericQuantity > 0
      ? {
          side,
          entry: plannedEntry,
          takeProfit: numericTakeProfit,
          stopLoss: numericStopLoss,
          quantity: numericQuantity,
          leverage: numericLeverage,
          liquidationPrice: plannedLiquidationPrice,
          status: "planned",
          pnl: 0,
        }
      : null;

  function validateTicket() {
    if (!detail) return "Wait for a verified price before creating an order.";
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) return "Enter a quantity greater than zero.";
    if (!Number.isFinite(plannedEntry) || plannedEntry <= 0) return "Enter a valid entry price.";
    if (!Number.isFinite(numericTakeProfit) || !Number.isFinite(numericStopLoss)) return "Enter valid bracket prices.";
    if (
      side === "long"
      && (numericTakeProfit <= plannedEntry || numericStopLoss >= plannedEntry)
    ) {
      return "For a long trade, take profit must be above entry and stop loss below entry.";
    }
    if (
      side === "short"
      && (numericTakeProfit >= plannedEntry || numericStopLoss <= plannedEntry)
    ) {
      return "For a short trade, take profit must be below entry and stop loss above entry.";
    }
    if (plannedRisk <= 0) return "The stop-loss distance must be greater than zero.";
    if (numericLeverage > 1 && (
      side === "long"
        ? numericStopLoss <= plannedLiquidationPrice
        : numericStopLoss >= plannedLiquidationPrice
    )) {
      return `Move the stop loss inside the simulated ${numericLeverage}× liquidation level.`;
    }
    if (plannedMargin > freeMargin) {
      return `This ${selectedCurrency} ledger does not have enough free margin.`;
    }
    if (account.positions.length + account.pendingOrders.length >= PAPER_MAX_POSITIONS) {
      return `The demo supports up to ${PAPER_MAX_POSITIONS} open positions and pending orders.`;
    }
    return null;
  }

  function reviewOrder() {
    const error = validateTicket();
    setTicketError(error);
    if (error) return;
    setReviewing(true);
  }

  function confirmOrder() {
    const error = validateTicket();
    setTicketError(error);
    if (error || !detail) return;

    if (orderType === "market") {
      setAccount((current) => ({
        ...current,
        positions: [...current.positions, {
          id: paperId("position"),
          symbol: detail.symbol,
          name: detail.name,
          currency: detail.currency,
          side,
          quantity: numericQuantity,
          leverage: numericLeverage,
          entryPrice: plannedEntry,
          takeProfit: numericTakeProfit,
          stopLoss: numericStopLoss,
          openedAt: Date.now(),
          note: tradeNote.trim() || undefined,
        }],
      }));
      setLedgerTab("positions");
    } else {
      setAccount((current) => ({
        ...current,
        pendingOrders: [...current.pendingOrders, {
          id: paperId("order"),
          symbol: detail.symbol,
          name: detail.name,
          currency: detail.currency,
          side,
          orderType,
          quantity: numericQuantity,
          leverage: numericLeverage,
          triggerPrice: plannedEntry,
          takeProfit: numericTakeProfit,
          stopLoss: numericStopLoss,
          createdAt: Date.now(),
          note: tradeNote.trim() || undefined,
        }],
      }));
      setLedgerTab("orders");
    }
    setTradeNote("");
    setReviewing(false);
    setTicketError(null);
  }

  function autoSize() {
    const stopDistance = Math.abs(plannedEntry - numericStopLoss);
    const riskBudget = equity * Math.max(0.1, Math.min(5, Number(riskPercent) || 1)) / 100;
    if (!stopDistance || !plannedEntry) {
      setTicketError("Set an entry and stop loss before calculating size.");
      return;
    }
    const riskSized = riskBudget / stopDistance;
    const powerSized = buyingPower / plannedEntry;
    const nextQuantity = Math.max(0, Math.min(riskSized, powerSized));
    setQuantity(String(paperPrice(nextQuantity)));
    setReviewing(false);
    setTicketError(null);
  }

  function closePosition(position: PaperPosition) {
    const quote = quoteBySymbol.get(position.symbol);
    if (!quote) {
      setTicketError(`No verified ${position.symbol} price is available to close this demo position.`);
      return;
    }
    const exitPrice = paperExitFill(quote.price, position.side, position.symbol);
    const closed: PaperClosedTrade = {
      ...position,
      exitPrice,
      closedAt: Date.now(),
      closeReason: "Manual close",
      pnl: paperPnl(position, exitPrice),
    };
    setAccount((current) => ({
      positions: current.positions.filter((item) => item.id !== position.id),
      pendingOrders: current.pendingOrders,
      history: [closed, ...current.history].slice(0, 250),
    }));
    setLedgerTab("history");
  }

  function cancelOrder(orderId: string) {
    setAccount((current) => ({
      ...current,
      pendingOrders: current.pendingOrders.filter((order) => order.id !== orderId),
    }));
  }

  const moveChartLevel = useCallback((level: "takeProfit" | "stopLoss", price: number) => {
    if (activePosition) {
      const minimumDistance = Math.max(activePosition.entryPrice * 0.0001, 0.0001);
      let adjustedPrice = level === "takeProfit"
        ? activePosition.side === "long"
          ? Math.max(price, activePosition.entryPrice + minimumDistance)
          : Math.min(price, activePosition.entryPrice - minimumDistance)
        : activePosition.side === "long"
          ? Math.min(price, activePosition.entryPrice - minimumDistance)
          : Math.max(price, activePosition.entryPrice + minimumDistance);
      if (level === "stopLoss" && paperLeverage(activePosition.leverage) > 1) {
        const liquidation = paperLiquidationPrice(activePosition);
        adjustedPrice = activePosition.side === "long"
          ? Math.max(adjustedPrice, liquidation + minimumDistance)
          : Math.min(adjustedPrice, liquidation - minimumDistance);
      }
      setAccount((current) => ({
        ...current,
        positions: current.positions.map((position) => (
          position.id === activePosition.id
            ? { ...position, [level]: paperPrice(adjustedPrice) }
            : position
        )),
      }));
    } else if (level === "takeProfit") {
      const minimumDistance = Math.max(plannedEntry * 0.0001, 0.0001);
      const adjustedPrice = side === "long"
        ? Math.max(price, plannedEntry + minimumDistance)
        : Math.min(price, plannedEntry - minimumDistance);
      setTakeProfit(String(paperPrice(adjustedPrice)));
      setReviewing(false);
    } else {
      const minimumDistance = Math.max(plannedEntry * 0.0001, 0.0001);
      let adjustedPrice = side === "long"
        ? Math.min(price, plannedEntry - minimumDistance)
        : Math.max(price, plannedEntry + minimumDistance);
      if (numericLeverage > 1) {
        adjustedPrice = side === "long"
          ? Math.max(adjustedPrice, plannedLiquidationPrice + minimumDistance)
          : Math.min(adjustedPrice, plannedLiquidationPrice - minimumDistance);
      }
      setStopLoss(String(paperPrice(adjustedPrice)));
      setReviewing(false);
    }
  }, [activePosition, numericLeverage, plannedEntry, plannedLiquidationPrice, side]);

  function resetPaperAccount() {
    if (!window.confirm("Reset the paper account and erase its simulated positions, orders, and trade history on this browser?")) return;
    setAccount(EMPTY_PAPER_ACCOUNT);
    setPositionQuotes([]);
    setLedgerTab("positions");
  }

  return (
    <section className="paper-page">
      <header className="paper-hero">
        <div>
          <span className="eyebrow">SIMULATED EXECUTION LAB</span>
          <h1>Paper trader</h1>
          <p>Plan, place, and manage simulated trades against Ledger&apos;s latest displayed market prices.</p>
        </div>
        <div className="paper-safety">
          <span>DEMO ONLY</span>
          <strong>No broker. No real money.</strong>
          <small>Orders stay in this browser and cannot reach an exchange.</small>
        </div>
      </header>

      <div className="paper-account-strip">
        <div>
          <span>{selectedCurrency} EQUITY</span>
          <strong>{formatMoney(equity, selectedCurrency)}</strong>
          <small>{formatMoney(unrealizedPnl, selectedCurrency)} open P&amp;L</small>
        </div>
        <div>
          <span>FREE MARGIN</span>
          <strong>{formatMoney(freeMargin, selectedCurrency)}</strong>
          <small>{formatMoney(usedMargin + reservedMargin, selectedCurrency)} used + reserved</small>
        </div>
        <div>
          <span>REALIZED P&amp;L</span>
          <strong className={realizedPnl >= 0 ? "up-text" : "down-text"}>
            {realizedPnl >= 0 ? "+" : ""}{formatMoney(realizedPnl, selectedCurrency)}
          </strong>
          <small>{selectedHistory.length} closed {selectedCurrency} trades</small>
        </div>
        <div>
          <span>WIN RATE</span>
          <strong>{selectedHistory.length ? `${winRate.toFixed(1)}%` : "—"}</strong>
          <small>{account.positions.length} open · {account.pendingOrders.length} pending</small>
        </div>
      </div>

      <div className="paper-workspace">
        <section className="paper-chart-card panel">
          <div className="paper-chart-toolbar">
            <div className="paper-symbol-picker">
              <SearchableTickerSelect
                value={symbol}
                options={tickerOptions}
                onChange={onSelectTicker}
                tone="dark"
                ariaLabel="Choose ticker for paper trading"
              />
              <div>
                <strong>{detail?.name || symbol}</strong>
                <small>{detail ? `${detail.exchange} · ${detail.marketState}` : "Connecting to price feed"}</small>
              </div>
            </div>
            <div className="paper-range-buttons" aria-label="Paper trading chart range">
              {RANGE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={range === option ? "active" : ""}
                  onClick={() => onRangeChange(option)}
                  disabled={symbol === GOLD_SPOT_SYMBOL && option !== "1D"}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="paper-live-price">
              <span className={detail?.live ? "live" : ""} />
              <div>
                <strong>{detail ? formatMoney(detail.price, detail.currency) : "—"}</strong>
                <small>{loading ? "REFRESHING" : detail?.live ? "LIVE QUOTE" : "LATEST QUOTE"}</small>
              </div>
            </div>
          </div>

          <div className="paper-chart-shell">
            {detail ? (
              <PaperTradingChart
                points={detail.points}
                range={range}
                currency={detail.currency}
                currentPrice={detail.price}
                overlay={chartOverlay}
                onMoveLevel={moveChartLevel}
              />
            ) : (
              <div className="paper-chart-empty">
                <span />
                <strong>{loading ? `Loading ${symbol} chart…` : "Verified chart data unavailable"}</strong>
              </div>
            )}
            {chartOverlay && (
              <div className="paper-drag-hint">
                <span>↕</span> Drag the TP or SL handle to adjust
              </div>
            )}
          </div>

          {activePosition ? (
            <div className="paper-position-bar">
              <div className={activePosition.side}>
                <span>{activePosition.side === "long" ? "LONG" : "SHORT"} POSITION</span>
                <strong>{activePosition.quantity.toLocaleString()} {activePosition.symbol}</strong>
              </div>
              <div>
                <span>ENTRY</span>
                <strong>{formatMoney(activePosition.entryPrice, activePosition.currency)}</strong>
              </div>
              <div>
                <span>MARGIN · {paperLeverage(activePosition.leverage)}×</span>
                <strong>{formatMoney(paperPositionMargin(activePosition), activePosition.currency)}</strong>
                <small>
                  {paperLeverage(activePosition.leverage) > 1
                    ? `LIQ ${formatMoney(paperLiquidationPrice(activePosition), activePosition.currency)}`
                    : "NO AUTO-LIQ AT 1×"}
                </small>
              </div>
              <div>
                <span>OPEN P&amp;L</span>
                <strong className={paperPnl(activePosition, activePositionPrice) >= 0 ? "up-text" : "down-text"}>
                  {paperPnl(activePosition, activePositionPrice) >= 0 ? "+" : ""}
                  {formatMoney(paperPnl(activePosition, activePositionPrice), activePosition.currency)}
                  <small> {paperPercent(activePosition, activePositionPrice).toFixed(2)}%</small>
                </strong>
              </div>
              <button type="button" onClick={() => closePosition(activePosition)}>Close at market</button>
            </div>
          ) : (
            <div className="paper-position-bar planned">
              <div>
                <span>CHART PREVIEW</span>
                <strong>{side === "long" ? "Long" : "Short"} setup</strong>
              </div>
              <p>The shaded risk/reward tool previews this ticket before you place the paper order.</p>
            </div>
          )}
        </section>

        <aside className="paper-ticket panel">
          <div className="paper-ticket-heading">
            <div>
              <span className="eyebrow">ORDER TICKET</span>
              <h2>{symbol}</h2>
            </div>
            <span>PAPER</span>
          </div>

          <div className="paper-side-toggle">
            <button
              type="button"
              className={side === "long" ? "active long" : ""}
              onClick={() => setSide("long")}
            >
              Buy / Long
            </button>
            <button
              type="button"
              className={side === "short" ? "active short" : ""}
              onClick={() => setSide("short")}
            >
              Sell / Short
            </button>
          </div>

          <div className="paper-order-types" aria-label="Paper order type">
            {(["market", "limit", "stop"] as PaperOrderType[]).map((type) => (
              <button
                type="button"
                key={type}
                className={orderType === type ? "active" : ""}
                onClick={() => {
                  setOrderType(type);
                  setReviewing(false);
                }}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="paper-leverage-control">
            <div className="paper-leverage-heading">
              <div>
                <span>LEVERAGE</span>
                <strong>{numericLeverage}×</strong>
              </div>
              <small>{formatMoney(buyingPower, selectedCurrency)} ticket buying power</small>
            </div>
            <input
              type="range"
              min="1"
              max={PAPER_MAX_LEVERAGE}
              step="1"
              value={numericLeverage}
              onChange={(event) => {
                setLeverage(String(paperLeverage(Number(event.target.value))));
                setReviewing(false);
                setTicketError(null);
              }}
              aria-label="Paper trade leverage"
            />
            <div className="paper-leverage-presets" aria-label="Leverage presets">
              {[1, 2, 5, 10, 20, 50].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={numericLeverage === value ? "active" : ""}
                  onClick={() => {
                    setLeverage(String(value));
                    setReviewing(false);
                    setTicketError(null);
                  }}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>

          <div className="paper-ticket-fields">
            <label>
              <span>QUANTITY</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setReviewing(false);
                }}
              />
            </label>
            <label>
              <span>{orderType === "market" ? "EST. ENTRY" : orderType === "limit" ? "LIMIT PRICE" : "STOP TRIGGER"}</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={orderType === "market" && detail ? detail.price : orderPrice}
                disabled={orderType === "market"}
                onChange={(event) => {
                  setOrderPrice(event.target.value);
                  setReviewing(false);
                }}
              />
            </label>
            <label className="take-profit">
              <span>TAKE PROFIT</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={takeProfit}
                onChange={(event) => {
                  setTakeProfit(event.target.value);
                  setReviewing(false);
                }}
              />
            </label>
            <label className="stop-loss">
              <span>STOP LOSS</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  setReviewing(false);
                }}
              />
            </label>
          </div>

          <div className="paper-risk-size">
            <label>
              <span>RISK THIS TRADE</span>
              <div>
                <input
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={riskPercent}
                  onChange={(event) => setRiskPercent(event.target.value)}
                />
                <b>%</b>
              </div>
            </label>
            <button type="button" onClick={autoSize}>Auto-size</button>
          </div>

          <div className="paper-ticket-math">
            <div><span>NOTIONAL</span><strong>{formatMoney(plannedNotional, selectedCurrency)}</strong></div>
            <div><span>MARGIN NEEDED</span><strong>{formatMoney(plannedMargin, selectedCurrency)}</strong></div>
            <div><span>MAX RISK</span><strong className="down-text">−{formatMoney(plannedRisk, selectedCurrency)}</strong></div>
            <div><span>MAX TARGET</span><strong className="up-text">+{formatMoney(plannedTarget, selectedCurrency)}</strong></div>
            <div><span>RISK / REWARD</span><strong>{Number.isFinite(plannedRiskReward) ? plannedRiskReward.toFixed(2) : "—"}</strong></div>
            <div>
              <span>EST. LIQUIDATION</span>
              <strong>{numericLeverage > 1 ? formatMoney(plannedLiquidationPrice, selectedCurrency) : "N/A AT 1×"}</strong>
            </div>
          </div>

          <label className="paper-note-field">
            <span>TRADE NOTE <small>OPTIONAL</small></span>
            <input
              value={tradeNote}
              onChange={(event) => setTradeNote(event.target.value.slice(0, 120))}
              placeholder="Catalyst, setup, or invalidation…"
            />
          </label>

          {ticketError && <div className="paper-ticket-error" role="status">{ticketError}</div>}

          {reviewing ? (
            <div className="paper-order-review">
              <div>
                <span>READY TO SIMULATE</span>
                <strong>{side === "long" ? "Buy" : "Sell short"} {numericQuantity.toLocaleString()} {symbol}</strong>
                <small>
                  {orderType === "market"
                    ? `Estimated at ${formatMoney(plannedEntry, selectedCurrency)}`
                    : `${orderType} at ${formatMoney(plannedEntry, selectedCurrency)}`}
                  {` · ${numericLeverage}× leverage · ${formatMoney(plannedMargin, selectedCurrency)} margin`}
                </small>
              </div>
              <button type="button" onClick={confirmOrder}>Confirm paper order</button>
              <button type="button" onClick={() => setReviewing(false)}>Edit ticket</button>
            </div>
          ) : (
            <button
              type="button"
              className={`paper-review-button ${side}`}
              onClick={reviewOrder}
              disabled={!detail}
            >
              Review paper order
            </button>
          )}

          <p className="paper-fill-note">
            Market and stop fills include {executionCostBps.toFixed(2)} bps one-way modeled execution cost
            {PACKED_TRADING_COSTS[symbol === "GOOGL" ? "GOOG" : symbol] ? " from the historical BID/ASK pack plus a slippage floor" : " using the fallback slippage model"}.
            TP and SL act as an OCO pair. Leveraged positions use isolated demo margin with a 0.5% maintenance assumption.
          </p>
        </aside>
      </div>

      <section className="paper-ledger panel">
        <div className="paper-ledger-heading">
          <div className="paper-ledger-tabs">
            <button
              type="button"
              className={ledgerTab === "positions" ? "active" : ""}
              onClick={() => setLedgerTab("positions")}
            >
              Positions <span>{account.positions.length}</span>
            </button>
            <button
              type="button"
              className={ledgerTab === "orders" ? "active" : ""}
              onClick={() => setLedgerTab("orders")}
            >
              Pending orders <span>{account.pendingOrders.length}</span>
            </button>
            <button
              type="button"
              className={ledgerTab === "history" ? "active" : ""}
              onClick={() => setLedgerTab("history")}
            >
              Trade history <span>{account.history.length}</span>
            </button>
          </div>
          <button type="button" className="paper-reset" onClick={resetPaperAccount}>Reset demo account</button>
        </div>

        <div className="paper-table-scroll">
          {ledgerTab === "positions" ? (
            account.positions.length ? (
              <table>
                <thead>
                  <tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Leverage</th><th>Margin</th><th>Entry</th><th>Last</th><th>Take profit</th><th>Stop loss</th><th>Liquidation</th><th>Open P&amp;L</th><th /></tr>
                </thead>
                <tbody>
                  {account.positions.map((position) => {
                    const quote = quoteBySymbol.get(position.symbol);
                    const openPnl = quote ? paperPnl(position, quote.price) : null;
                    return (
                      <tr key={position.id}>
                        <td><button type="button" onClick={() => onSelectTicker(position.symbol)}><strong>{position.symbol}</strong><small>{position.note || position.name}</small></button></td>
                        <td><span className={`paper-side-chip ${position.side}`}>{position.side.toUpperCase()}</span></td>
                        <td>{position.quantity.toLocaleString()}</td>
                        <td><strong>{paperLeverage(position.leverage)}×</strong></td>
                        <td>{formatMoney(paperPositionMargin(position), position.currency)}</td>
                        <td>{formatMoney(position.entryPrice, position.currency)}</td>
                        <td>{quote ? formatMoney(quote.price, position.currency) : "Waiting…"}</td>
                        <td className="up-text">{formatMoney(position.takeProfit, position.currency)}</td>
                        <td className="down-text">{formatMoney(position.stopLoss, position.currency)}</td>
                        <td>{paperLeverage(position.leverage) > 1 ? formatMoney(paperLiquidationPrice(position), position.currency) : "—"}</td>
                        <td className={(openPnl || 0) >= 0 ? "up-text" : "down-text"}>
                          {openPnl === null ? "—" : `${openPnl >= 0 ? "+" : ""}${formatMoney(openPnl, position.currency)}`}
                        </td>
                        <td><button type="button" className="paper-row-action" onClick={() => closePosition(position)}>Close</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="paper-ledger-empty"><span>◎</span><strong>No open positions</strong><small>Build an order ticket to start the simulation.</small></div>
            )
          ) : ledgerTab === "orders" ? (
            account.pendingOrders.length ? (
              <table>
                <thead>
                  <tr><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Leverage</th><th>Margin</th><th>Trigger</th><th>Take profit</th><th>Stop loss</th><th>Created</th><th /></tr>
                </thead>
                <tbody>
                  {account.pendingOrders.map((order) => (
                    <tr key={order.id}>
                      <td><button type="button" onClick={() => onSelectTicker(order.symbol)}><strong>{order.symbol}</strong><small>{order.note || order.name}</small></button></td>
                      <td><span className={`paper-side-chip ${order.side}`}>{order.side.toUpperCase()}</span></td>
                      <td>{order.orderType.toUpperCase()}</td>
                      <td>{order.quantity.toLocaleString()}</td>
                      <td><strong>{paperLeverage(order.leverage)}×</strong></td>
                      <td>{formatMoney((order.triggerPrice * order.quantity) / paperLeverage(order.leverage), order.currency)}</td>
                      <td>{formatMoney(order.triggerPrice, order.currency)}</td>
                      <td className="up-text">{formatMoney(order.takeProfit, order.currency)}</td>
                      <td className="down-text">{formatMoney(order.stopLoss, order.currency)}</td>
                      <td>{new Date(order.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                      <td><button type="button" className="paper-row-action" onClick={() => cancelOrder(order.id)}>Cancel</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="paper-ledger-empty"><span>⌛</span><strong>No pending orders</strong><small>Limit and stop entries will appear here until triggered or cancelled.</small></div>
            )
          ) : account.history.length ? (
            <table>
              <thead>
                <tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Leverage</th><th>Margin</th><th>Entry</th><th>Exit</th><th>Result</th><th>Reason</th><th>Closed</th></tr>
              </thead>
              <tbody>
                {account.history.map((trade) => (
                  <tr key={`${trade.id}-${trade.closedAt}`}>
                    <td><button type="button" onClick={() => onSelectTicker(trade.symbol)}><strong>{trade.symbol}</strong><small>{trade.note || trade.name}</small></button></td>
                    <td><span className={`paper-side-chip ${trade.side}`}>{trade.side.toUpperCase()}</span></td>
                    <td>{trade.quantity.toLocaleString()}</td>
                    <td><strong>{paperLeverage(trade.leverage)}×</strong></td>
                    <td>{formatMoney(paperPositionMargin(trade), trade.currency)}</td>
                    <td>{formatMoney(trade.entryPrice, trade.currency)}</td>
                    <td>{formatMoney(trade.exitPrice, trade.currency)}</td>
                    <td className={trade.pnl >= 0 ? "up-text" : "down-text"}>{trade.pnl >= 0 ? "+" : ""}{formatMoney(trade.pnl, trade.currency)}</td>
                    <td>{trade.closeReason}</td>
                    <td>{new Date(trade.closedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="paper-ledger-empty"><span>↻</span><strong>No closed trades</strong><small>Completed simulations will build your local trade journal.</small></div>
          )}
        </div>
      </section>

      <p className="paper-disclaimer">
        Paper trading is an educational simulation. It does not model order-book depth, exchange fees, taxes,
        halts, partial fills, borrow availability, dividends, or exact bid/ask execution. Quotes can be delayed.
        Leverage and liquidation are simplified educational estimates, not broker formulas. Each quote currency
        uses a separate 100,000-unit demo ledger, with no foreign-exchange conversion.
      </p>
    </section>
  );
}

export default function Home() {
  const [activeView, setActiveView] = useState<"dashboard" | "trade" | "mega" | "finder" | "news" | "congress" | "x" | "truth" | "history" | "portfolio">("dashboard");
  const [symbol, setSymbol] = useState("AAPL");
  const [range, setRange] = useState<RangeKey>("1D");
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [watchlists, setWatchlists] = useState<SavedWatchlist[]>(DEFAULT_WATCHLISTS);
  const [activeWatchlistId, setActiveWatchlistId] = useState("default");
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [showWatchlistCreator, setShowWatchlistCreator] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [showTickerAdder, setShowTickerAdder] = useState(false);
  const [watchlistTicker, setWatchlistTicker] = useState("");
  const watchlistSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [indices, setIndices] = useState<Quote[]>([]);
  const [pulseSymbols, setPulseSymbols] = useState<string[]>(INDEX_SYMBOLS);
  const [showPulseAdder, setShowPulseAdder] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [lastLatency, setLastLatency] = useState(0);
  const [freshnessNow, setFreshnessNow] = useState(Date.now());
  const [pricePulse, setPricePulse] = useState<"up" | "down" | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const quietDetailInFlightRef = useRef(false);
  const quoteRequestsInFlightRef = useRef(new Set<string>());
  const previousPriceRef = useRef<{ symbol: string; price: number } | null>(null);
  const activeWatchlist = watchlists.find((list) => list.id === activeWatchlistId) || watchlists[0];
  const watchlist = activeWatchlist?.symbols || DEFAULT_WATCHLIST;

  useEffect(() => {
    const saved = window.localStorage.getItem(MARKET_PULSE_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      const symbols = Array.isArray(parsed)
        ? [...new Set(parsed
            .map((item) => typeof item === "string" ? cleanTicker(item) : "")
            .filter(Boolean))]
            .slice(0, MARKET_PULSE_LIMIT)
        : [];
      if (symbols.length) setPulseSymbols(symbols);
    } catch {
      window.localStorage.removeItem(MARKET_PULSE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWatchlists() {
      try {
        const response = await fetch("/api/watchlists", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Watchlist request failed");
        const payload = await response.json() as { watchlists?: SavedWatchlist[] };
        let savedLists = Array.isArray(payload.watchlists)
          ? payload.watchlists.filter((list) => (
              typeof list?.id === "string"
              && typeof list?.name === "string"
              && Array.isArray(list?.symbols)
            ))
          : [];
        if (!savedLists.length) throw new Error("No watchlists returned");

        const legacyValue = window.localStorage.getItem("ledger-watchlist");
        if (legacyValue) {
          try {
            const parsed = JSON.parse(legacyValue);
            const legacySymbols = Array.isArray(parsed)
              ? [...new Set(parsed
                  .map((item) => typeof item === "string" ? cleanTicker(item) : "")
                  .filter(Boolean))]
                  .slice(0, 9)
              : [];
            const defaultList = savedLists.find((list) => list.id === "default");
            const untouchedDefault = defaultList
              && defaultList.symbols.join(",") === DEFAULT_WATCHLIST.join(",");
            if (legacySymbols.length && untouchedDefault) {
              savedLists = savedLists.map((list) => (
                list.id === "default" ? { ...list, symbols: legacySymbols } : list
              ));
              const migrationResponse = await fetch("/api/watchlists", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "default", symbols: legacySymbols }),
              });
              if (!migrationResponse.ok) throw new Error("Legacy watchlist migration failed");
            }
            window.localStorage.removeItem("ledger-watchlist");
          } catch {
            // Ignore malformed data from the earlier single-list format.
          }
        }

        const savedActiveId = window.localStorage.getItem("ledger-active-watchlist");
        const nextActiveId = savedLists.some((list) => list.id === savedActiveId)
          ? savedActiveId as string
          : savedLists[0].id;
        setWatchlists(savedLists);
        setActiveWatchlistId(nextActiveId);
        setWatchlistError(null);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWatchlistError("Saved watchlists are temporarily unavailable.");
      } finally {
        setWatchlistLoading(false);
      }
    }

    loadWatchlists();
    return () => controller.abort();
  }, []);

  const fetchDetail = useCallback(async (nextSymbol: string, nextRange: RangeKey, quiet = false) => {
    if (quiet && quietDetailInFlightRef.current) return;
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    if (quiet) quietDetailInFlightRef.current = true;
    const startedAt = window.performance.now();
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/market?symbol=${encodeURIComponent(nextSymbol)}&range=${nextRange}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Quote request failed");
      const payload = (await response.json()) as MarketDetail;
      if (requestId !== detailRequestIdRef.current) return;
      setDetail((current) => {
        if (payload.symbol !== GOLD_SPOT_SYMBOL || !current || current.symbol !== GOLD_SPOT_SYMBOL) {
          return payload;
        }

        const nextPoint = payload.points[payload.points.length - 1];
        const previousPoint = current.points[current.points.length - 1];
        const points = previousPoint?.time === nextPoint.time
          ? [...current.points.slice(0, -1), nextPoint]
          : [...current.points, nextPoint].slice(-300);
        const values = points.map((point) => point.value);
        const sessionStart = current.open;
        const change = payload.price - sessionStart;
        return {
          ...payload,
          previousClose: sessionStart,
          change,
          changePercent: sessionStart ? (change / sessionStart) * 100 : 0,
          open: sessionStart,
          high: Math.max(...values),
          low: Math.min(...values),
          points,
        };
      });
      setLastUpdated(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
      setLastUpdatedAt(Date.now());
      setLastLatency(Math.max(1, Math.round(window.performance.now() - startedAt)));
      setMessage(null);
    } catch {
      if (requestId !== detailRequestIdRef.current) return;
      if (!quiet) {
        setDetail(null);
        setMessage("Live market data is currently unavailable. No substitute prices are being shown.");
      }
    } finally {
      if (quiet) quietDetailInFlightRef.current = false;
      if (!quiet && requestId === detailRequestIdRef.current) setLoading(false);
    }
  }, []);

  const fetchQuotes = useCallback(async (symbols: string[], set: (items: Quote[]) => void) => {
    if (!symbols.length) return;
    const requestKey = symbols.join(",");
    if (quoteRequestsInFlightRef.current.has(requestKey)) return;
    quoteRequestsInFlightRef.current.add(requestKey);
    try {
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Quote request failed");
      const payload = (await response.json()) as { quotes: Quote[] };
      const bySymbol = new Map(payload.quotes.map((quote) => [quote.symbol, quote]));
      const nextQuotes = symbols.flatMap((item) => {
        const quote = bySymbol.get(item);
        return quote ? [quote] : [];
      });
      if (nextQuotes.length) set(nextQuotes);
    } catch {
      // Keep the last verified quotes during a brief refresh failure.
    } finally {
      quoteRequestsInFlightRef.current.delete(requestKey);
    }
  }, []);

  useEffect(() => {
    fetchDetail(symbol, range);
  }, [fetchDetail, range, symbol]);

  useEffect(() => {
    fetchQuotes(watchlist, setQuotes);
  }, [fetchQuotes, watchlist]);

  useEffect(() => {
    fetchQuotes(pulseSymbols, setIndices);
  }, [fetchQuotes, pulseSymbols]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchDetail(symbol, range, true);
      fetchQuotes(watchlist, setQuotes);
      fetchQuotes(pulseSymbols, setIndices);
    }, 1_000);
    return () => window.clearInterval(refresh);
  }, [fetchDetail, fetchQuotes, pulseSymbols, range, symbol, watchlist]);

  useEffect(() => {
    const clock = window.setInterval(() => setFreshnessNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!detail) return;
    const previous = previousPriceRef.current;
    previousPriceRef.current = { symbol: detail.symbol, price: detail.price };
    if (!previous || previous.symbol !== detail.symbol || previous.price === detail.price) return;
    setPricePulse(detail.price > previous.price ? "up" : "down");
    const clear = window.setTimeout(() => setPricePulse(""), 620);
    return () => window.clearTimeout(clear);
  }, [detail?.price, detail?.symbol]);

  const positive = detail ? detail.change >= 0 : false;
  const dayPosition = detail
    ? detail.high === detail.low
      ? 50
      : ((detail.price - detail.low) / (detail.high - detail.low)) * 100
    : 0;
  const quoteAgeSeconds = lastUpdatedAt
    ? Math.max(0, Math.floor((freshnessNow - lastUpdatedAt) / 1_000))
    : 0;
  const quoteStale = Boolean(detail && quoteAgeSeconds > 12);
  const marketLabel = detail
    ? quoteStale ? "STALE · RETRYING" : "LIVE FEED"
    : loading ? "CONNECTING" : "FEED UNAVAILABLE";

  const sortedMovers = useMemo(
    () => [...quotes].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 3),
    [quotes],
  );
  const tickerOptions = useMemo(() => {
    const options = new Map<string, TickerOption>();
    quotes.forEach((quote) => options.set(quote.symbol, { symbol: quote.symbol, name: quote.name }));
    watchlist.forEach((item) => {
      if (!options.has(item)) options.set(item, { symbol: item, name: "Watchlist ticker" });
    });
    if (!options.has(symbol)) options.set(symbol, { symbol, name: "Current ticker" });
    TICKER_CATALOG.forEach((option) => {
      if (!options.has(option.symbol)) options.set(option.symbol, option);
    });
    Object.values(CATEGORY_BOARDS).forEach((board) => {
      board.instruments.forEach((option) => {
        if (!options.has(option.symbol)) options.set(option.symbol, option);
      });
    });
    ALL_GLOBAL_STOCK_MARKETS.forEach((market) => {
      market.instruments.forEach((option) => {
        if (!options.has(option.symbol)) options.set(option.symbol, option);
      });
    });
    return [...options.values()];
  }, [quotes, symbol, watchlist]);

  function saveWatchlistSymbols(id: string, symbols: string[]) {
    const save = async () => {
      try {
        const response = await fetch("/api/watchlists", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, symbols }),
        });
        if (!response.ok) throw new Error("Watchlist update failed");
        setWatchlistError(null);
      } catch {
        setWatchlistError("That change could not be saved. Please try again.");
      }
    };
    const queuedSave = watchlistSaveQueueRef.current.catch(() => undefined).then(save);
    watchlistSaveQueueRef.current = queuedSave;
    return queuedSave;
  }

  function selectStock(nextSymbol: string) {
    setActiveView("dashboard");
    setDetail(null);
    setLoading(true);
    setSymbol(nextSymbol);
    setRange("1D");
    setMessage(null);
  }

  function selectPaperTicker(nextSymbol: string) {
    setActiveView("trade");
    setDetail(null);
    setLoading(true);
    setSymbol(nextSymbol);
    setRange("1D");
    setMessage(null);
  }

  function addStock(event: FormEvent) {
    event.preventDefault();
    const cleaned = cleanTicker(query);
    if (!addTickerToActiveWatchlist(cleaned)) return;
    setQuery("");
  }

  function addTickerToActiveWatchlist(cleaned: string) {
    if (!cleaned || !activeWatchlist) return false;
    const next = [cleaned, ...watchlist.filter((item) => item !== cleaned)].slice(0, 9);
    setWatchlists((current) => current.map((list) => (
      list.id === activeWatchlist.id ? { ...list, symbols: next } : list
    )));
    void saveWatchlistSymbols(activeWatchlist.id, next);
    selectStock(cleaned);
    return true;
  }

  function addTickerFromWatchlist(event: FormEvent) {
    event.preventDefault();
    const cleaned = cleanTicker(watchlistTicker);
    if (!addTickerToActiveWatchlist(cleaned)) return;
    setWatchlistTicker("");
    setShowTickerAdder(false);
  }

  function chooseWatchlist(id: string) {
    const nextList = watchlists.find((list) => list.id === id);
    if (!nextList) return;
    setActiveWatchlistId(id);
    window.localStorage.setItem("ledger-active-watchlist", id);
    setShowTickerAdder(false);
    setWatchlistTicker("");
    if (nextList.symbols[0]) selectStock(nextList.symbols[0]);
  }

  async function createWatchlist(event: FormEvent) {
    event.preventDefault();
    const name = newWatchlistName.trim().replace(/\s+/g, " ").slice(0, 36);
    if (!name || creatingWatchlist) return;
    setCreatingWatchlist(true);
    setWatchlistError(null);
    try {
      const response = await fetch("/api/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, symbols: [symbol] }),
      });
      const payload = await response.json() as { watchlist?: SavedWatchlist; error?: string };
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || "Watchlist creation failed");
      }
      setWatchlists((current) => [...current, payload.watchlist as SavedWatchlist]);
      setActiveWatchlistId(payload.watchlist.id);
      window.localStorage.setItem("ledger-active-watchlist", payload.watchlist.id);
      setNewWatchlistName("");
      setShowWatchlistCreator(false);
    } catch (error: unknown) {
      setWatchlistError(error instanceof Error ? error.message : "The watchlist could not be created.");
    } finally {
      setCreatingWatchlist(false);
    }
  }

  function cancelWatchlistCreation() {
    setShowWatchlistCreator(false);
    setNewWatchlistName("");
    setWatchlistError(null);
  }

  function removeStock(item: string) {
    if (!activeWatchlist || watchlist.length === 1) return;
    const next = watchlist.filter((candidate) => candidate !== item);
    setWatchlists((current) => current.map((list) => (
      list.id === activeWatchlist.id ? { ...list, symbols: next } : list
    )));
    void saveWatchlistSymbols(activeWatchlist.id, next);
    if (symbol === item) selectStock(next[0]);
  }

  function savePulseSymbols(next: string[]) {
    setPulseSymbols(next);
    window.localStorage.setItem(MARKET_PULSE_STORAGE_KEY, JSON.stringify(next));
  }

  function addPulseTicker(nextSymbol: string) {
    const cleaned = cleanTicker(nextSymbol);
    if (!cleaned) return;
    const next = pulseSymbols.includes(cleaned)
      ? pulseSymbols
      : [...pulseSymbols, cleaned].slice(0, MARKET_PULSE_LIMIT);
    savePulseSymbols(next);
    setShowPulseAdder(false);
  }

  function removePulseTicker(nextSymbol: string) {
    if (INDEX_SYMBOLS.includes(nextSymbol)) return;
    const next = pulseSymbols.filter((item) => item !== nextSymbol);
    if (!next.length) return;
    savePulseSymbols(next);
    setIndices((current) => current.filter((item) => item.symbol !== nextSymbol));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Ledger market dashboard home">
          <span className="brand-mark">L</span>
          <span>LEDGER</span>
        </a>
        <form className="search" onSubmit={addStock}>
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search stock symbol"
            placeholder="Search ticker — e.g. AMD or XAUUSD"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">Add</button>
        </form>
        <div className="feed-status">
          <span className={`status-dot ${detail ? quoteStale ? "stale" : "" : "offline"}`} />
          <div>
            <strong>{marketLabel}</strong>
            <small>
              {detail && lastUpdated
                ? `${quoteAgeSeconds < 2 ? "Updated now" : `Updated ${quoteAgeSeconds}s ago`} · ${lastLatency}ms`
                : loading ? "Connecting…" : "Provider unavailable"}
            </small>
          </div>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Dashboard sections">
        <button
          className={activeView === "dashboard" ? "active" : ""}
          onClick={() => setActiveView("dashboard")}
          aria-pressed={activeView === "dashboard"}
        >
          Market dashboard
        </button>
        <button
          className={activeView === "trade" ? "active" : ""}
          onClick={() => setActiveView("trade")}
          aria-pressed={activeView === "trade"}
        >
          Paper trader
        </button>
        <button
          className={activeView === "mega" ? "active" : ""}
          onClick={() => setActiveView("mega")}
          aria-pressed={activeView === "mega"}
        >
          Markets
        </button>
        <button
          className={activeView === "finder" ? "active" : ""}
          onClick={() => setActiveView("finder")}
          aria-pressed={activeView === "finder"}
        >
          Company finder
        </button>
        <button
          className={activeView === "news" ? "active" : ""}
          onClick={() => setActiveView("news")}
          aria-pressed={activeView === "news"}
        >
          News desk
        </button>
        <button
          className={activeView === "congress" ? "active" : ""}
          onClick={() => setActiveView("congress")}
          aria-pressed={activeView === "congress"}
        >
          Congress trades
        </button>
        <button
          className={activeView === "portfolio" ? "active" : ""}
          onClick={() => setActiveView("portfolio")}
          aria-pressed={activeView === "portfolio"}
        >
          Portfolio
        </button>
        <button
          className={activeView === "x" ? "active" : ""}
          onClick={() => setActiveView("x")}
          aria-pressed={activeView === "x"}
        >
          X tracker
        </button>
        <button
          className={activeView === "truth" ? "active" : ""}
          onClick={() => setActiveView("truth")}
          aria-pressed={activeView === "truth"}
        >
          Truth monitor
        </button>
        <button
          className={activeView === "history" ? "active" : ""}
          onClick={() => setActiveView("history")}
          aria-pressed={activeView === "history"}
        >
          Data vault
        </button>
      </nav>

      {activeView === "dashboard" ? (
        <>
          <section className="ticker-tape" aria-label="Market indices">
            <span className="tape-label">MARKET PULSE</span>
            {pulseSymbols.map((pulseSymbol) => {
              const item = indices.find((quote) => quote.symbol === pulseSymbol);
              return (
                <div className={`ticker-item-wrap ${item ? "" : "waiting"}`} key={pulseSymbol}>
                  <button
                    className="ticker-item"
                    onClick={() => selectStock(pulseSymbol)}
                    aria-label={`Open ${item?.name || pulseSymbol} chart`}
                    title={`Open ${item?.name || pulseSymbol} chart`}
                  >
                    <span>{indexNames[pulseSymbol] || pulseSymbol}</span>
                    {item ? (
                      <>
                        <strong>{item.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
                        <Change value={item.changePercent} percent />
                      </>
                    ) : (
                      <small>{loading ? "CONNECTING" : "UNAVAILABLE"}</small>
                    )}
                  </button>
                  {!INDEX_SYMBOLS.includes(pulseSymbol) && (
                    <button
                      className="ticker-remove"
                      onClick={() => removePulseTicker(pulseSymbol)}
                      aria-label={`Remove ${pulseSymbol} from Market Pulse`}
                      title={`Remove ${pulseSymbol}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <button
              className="pulse-add-button"
              onClick={() => setShowPulseAdder((current) => !current)}
              aria-expanded={showPulseAdder}
              aria-controls="market-pulse-adder"
            >
              + Add ticker
            </button>
            <span className="tape-note">Refreshes every 1s · Click any price to open its chart.</span>
          </section>

          {showPulseAdder && (
            <div className="pulse-adder" id="market-pulse-adder">
              <div>
                <span>EXPAND MARKET PULSE</span>
                <strong>Add any Yahoo Finance ticker</strong>
                <small>{pulseSymbols.length} of {MARKET_PULSE_LIMIT} slots used</small>
              </div>
              <SearchableTickerSelect
                value=""
                options={tickerOptions}
                onChange={addPulseTicker}
                ariaLabel="Search for a ticker to add to Market Pulse"
                triggerLabel="Choose a ticker"
                triggerDescription="Search all global listings"
              />
              <button
                className="pulse-adder-close"
                onClick={() => setShowPulseAdder(false)}
                aria-label="Close Market Pulse ticker picker"
              >
                Done
              </button>
            </div>
          )}

          {message && (
            <div className="notice" role="status">
              <span>{message}</span>
              <button onClick={() => setMessage(null)} aria-label="Dismiss message">×</button>
            </div>
          )}

          <div className="dashboard-grid">
        <aside className="watch-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PERSONAL LIST</span>
              <h2>{activeWatchlist?.name || "Watchlist"}</h2>
            </div>
            <span className="count-badge">{watchlist.length}</span>
          </div>
          <div className="watchlist-manager">
            <div className="watchlist-switcher">
              <label>
                <span>WATCHLIST</span>
                <select
                  value={activeWatchlist?.id || ""}
                  onChange={(event) => chooseWatchlist(event.target.value)}
                  disabled={watchlistLoading}
                  aria-label="Choose watchlist"
                >
                  {watchlists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setShowWatchlistCreator(true);
                  setWatchlistError(null);
                }}
                disabled={watchlists.length >= 12}
              >
                ＋ New list
              </button>
            </div>
            {showWatchlistCreator && (
              <form className="watchlist-creator" onSubmit={createWatchlist}>
                <input
                  autoFocus
                  value={newWatchlistName}
                  onChange={(event) => setNewWatchlistName(event.target.value)}
                  placeholder="Watchlist name"
                  aria-label="New watchlist name"
                  maxLength={36}
                />
                <button type="submit" disabled={!newWatchlistName.trim() || creatingWatchlist}>
                  {creatingWatchlist ? "Saving…" : "Create"}
                </button>
                <button type="button" onClick={cancelWatchlistCreation}>Cancel</button>
              </form>
            )}
            {watchlistError && <p className="watchlist-error" role="status">{watchlistError}</p>}
          </div>
          <div className="watch-header">
            <span>Asset</span>
            <span>Last</span>
            <span>Move</span>
          </div>
          <div className="watch-rows">
            {watchlist.map((item) => {
              const quote = quotes.find((candidate) => candidate.symbol === item);
              const selected = item === symbol;
              return (
                <div key={item} className={`watch-row ${selected ? "selected" : ""}`}>
                  <button className="watch-main" onClick={() => selectStock(item)} aria-pressed={selected}>
                    <span className="stock-avatar">{item.slice(0, 1)}</span>
                    <span className="asset-name">
                      <strong>{item}</strong>
                      <small>{quote?.name || "Loading quote"}</small>
                    </span>
                    <strong className="row-price">{quote ? quote.price.toFixed(2) : "—"}</strong>
                    <span className={quote && quote.changePercent < 0 ? "row-change down-text" : "row-change up-text"}>
                      {quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : "—"}
                    </span>
                  </button>
                  <button
                    className="remove"
                    onClick={() => removeStock(item)}
                    aria-label={`Remove ${item} from watchlist`}
                    disabled={watchlist.length === 1}
                    title={watchlist.length === 1 ? "Keep at least one ticker in the list" : undefined}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {showTickerAdder ? (
            <form className="watchlist-ticker-adder" onSubmit={addTickerFromWatchlist}>
              <label>
                <span>ADD TICKER</span>
                <input
                  autoFocus
                  value={watchlistTicker}
                  onChange={(event) => setWatchlistTicker(event.target.value)}
                  placeholder="e.g. AMD or XAUUSD"
                  aria-label="Ticker to add to watchlist"
                  list="watchlist-ticker-suggestions"
                  maxLength={12}
                />
                <datalist id="watchlist-ticker-suggestions">
                  {tickerOptions
                    .filter((option) => !watchlist.includes(option.symbol))
                    .map((option) => (
                      <option key={option.symbol} value={option.symbol}>{option.name}</option>
                    ))}
                </datalist>
              </label>
              <button type="submit" disabled={!cleanTicker(watchlistTicker)}>Add</button>
              <button
                type="button"
                onClick={() => {
                  setShowTickerAdder(false);
                  setWatchlistTicker("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              className="add-row"
              onClick={() => setShowTickerAdder(true)}
              disabled={watchlist.length >= 9}
            >
              <span>＋</span> {watchlist.length >= 9 ? "Watchlist is full" : "Add another ticker"}
            </button>
          )}
          <div className="watch-tip">
            <span>{watchlistLoading ? "SYNCING" : "SAVED"}</span>
            Named watchlists are stored in your private dashboard.
          </div>
        </aside>

        <section className="quote-panel panel">
          <div className="quote-header">
            <div className="quote-identity">
              <span className="stock-avatar hero-avatar">{symbol.slice(0, 1)}</span>
              <div>
                <div className="symbol-line">
                  <h1>{symbol}</h1>
                  <span className="exchange-badge">{detail?.exchange || "LIVE"}</span>
                </div>
                <p>{detail?.name || (loading ? "Requesting live market data…" : "Live market data unavailable")}</p>
              </div>
            </div>
            <div className="quote-actions" aria-label="Chart range">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={range === option ? "active" : ""}
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  disabled={symbol === GOLD_SPOT_SYMBOL && option !== "1D"}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {detail ? (
            <>
              <div className="price-line">
                <div>
                  <span className={`big-price ${pricePulse ? `price-pulse-${pricePulse}` : ""}`}>
                    {formatMoney(detail.price, detail.currency)}
                  </span>
                  <span className="currency">{detail.currency}</span>
                </div>
                <div className="session-move">
                  <Change value={detail.change} />
                  <Change value={detail.changePercent} percent />
                  <small>{range === "1D" ? "TODAY" : range}</small>
                </div>
              </div>

              <div className={`chart-wrap ${loading ? "loading" : ""}`}>
                <MarketChart points={detail.points} positive={positive} range={range} currency={detail.currency} />
                {loading && <span className="loading-pill">Refreshing data…</span>}
              </div>

              <div className="range-bar">
                <span>{formatMoney(detail.low, detail.currency)} LOW</span>
                <div><i style={{ left: `${Math.min(100, Math.max(0, dayPosition))}%` }} /></div>
                <span>HIGH {formatMoney(detail.high, detail.currency)}</span>
              </div>

              <div className="stat-grid">
                <div><span>OPEN</span><strong>{formatMoney(detail.open, detail.currency)}</strong></div>
                <div>
                  <span>{symbol === GOLD_SPOT_SYMBOL ? "SESSION START" : "PREV CLOSE"}</span>
                  <strong>{formatMoney(detail.previousClose, detail.currency)}</strong>
                </div>
                <div>
                  <span>{symbol === GOLD_SPOT_SYMBOL ? "LIVE RANGE" : "DAY RANGE"}</span>
                  <strong>{detail.low.toFixed(2)} — {detail.high.toFixed(2)}</strong>
                </div>
                <div><span>VOLUME</span><strong>{symbol === GOLD_SPOT_SYMBOL ? "N/A" : formatCompact(detail.volume)}</strong></div>
              </div>
            </>
          ) : (
            <div className="empty-market" role="status">
              <span className="empty-orbit" aria-hidden="true" />
              <span className="eyebrow">{loading ? "CONTACTING PROVIDER" : "LIVE DATA ONLY"}</span>
              <h3>{loading ? `Loading ${symbol}…` : "Market feed unavailable"}</h3>
              <p>
                {loading
                  ? "Waiting for a verified quote and chart."
                  : "Ledger will not display estimated or generated prices. It will retry automatically."}
              </p>
            </div>
          )}
        </section>

        <aside className="insights">
          <section className="panel movers-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">YOUR UNIVERSE</span>
                <h2>Biggest moves</h2>
              </div>
              <span className="asterisk">✳</span>
            </div>
            <div className="mover-list">
              {sortedMovers.map((item, index) => (
                <button key={item.symbol} className="mover" onClick={() => selectStock(item.symbol)}>
                  <span className="mover-rank">0{index + 1}</span>
                  <span>
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </span>
                  <Change value={item.changePercent} percent />
                </button>
              ))}
              {!sortedMovers.length && (
                <div className="mover-empty">Waiting for live watchlist quotes.</div>
              )}
            </div>
          </section>

          {detail ? (
            <section className="signal-card">
              <div className="signal-top">
                <span className="eyebrow">SESSION SIGNAL</span>
                <span className={positive ? "signal-chip" : "signal-chip negative"}>
                  {positive ? "POSITIVE" : "NEGATIVE"}
                </span>
              </div>
              <h3>
                {symbol} is trading {positive ? "above" : "below"} its {symbol === GOLD_SPOT_SYMBOL ? "session start" : "previous close"}.
              </h3>
              <p>
                {symbol === GOLD_SPOT_SYMBOL
                  ? `The live spot price sits at ${Math.round(dayPosition)}% of the range observed since you opened this gold chart.`
                  : `Today’s price sits at ${Math.round(dayPosition)}% of its intraday range, with ${formatCompact(detail.volume)} shares reported.`}
              </p>
              <div className="signal-meter">
                <span>LOW</span>
                <div><i style={{ width: `${Math.min(100, Math.max(3, dayPosition))}%` }} /></div>
                <span>HIGH</span>
              </div>
            </section>
          ) : (
            <section className="signal-card unavailable">
              <div className="signal-top">
                <span className="eyebrow">SESSION SIGNAL</span>
                <span className="signal-chip waiting">WAITING</span>
              </div>
              <h3>No signal without live data.</h3>
              <p>Market commentary appears only after a verified quote is received.</p>
            </section>
          )}

          <section className="disclaimer">
            <strong>For your eyes, not your orders.</strong>
            <p>Ledger is an information dashboard. Market data can be delayed and is not investment advice.</p>
          </section>
        </aside>
          </div>
          <ForwardMonteCarloPanel
            detail={detail}
            loading={loading}
            symbol={symbol}
            tickerOptions={tickerOptions}
            onSelectTicker={selectStock}
          />
        </>
      ) : activeView === "trade" ? (
        <PaperTradingPanel
          detail={detail}
          loading={loading}
          symbol={symbol}
          range={range}
          tickerOptions={tickerOptions}
          onSelectTicker={selectPaperTicker}
          onRangeChange={setRange}
        />
      ) : activeView === "history" ? (
        <HistoryPanel initialSymbol={symbol} tickerOptions={tickerOptions} />
      ) : activeView === "mega" ? (
        <MarketExplorerPanel onSelectStock={selectStock} />
      ) : activeView === "finder" ? (
        <CompanyFinderPanel onSelectStock={selectStock} />
      ) : activeView === "news" ? (
        <NewsPanel
          initialSymbol={symbol}
          tickerOptions={tickerOptions}
          watchlist={watchlist}
        />
      ) : activeView === "congress" ? (
        <CongressTradingPanel onSelectStock={selectStock} />
      ) : activeView === "portfolio" ? (
        <PortfolioPanel onSelectStock={selectStock} />
      ) : activeView === "x" ? (
        <XTrackerPanel
          initialSymbol={symbol}
          tickerOptions={tickerOptions}
          watchlist={watchlist}
        />
      ) : (
        <TruthSocialPanel
          initialSymbol={symbol}
          tickerOptions={tickerOptions}
          watchlist={watchlist}
        />
      )}
    </main>
  );
}
