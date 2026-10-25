"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildStockScenarioDefaults } from "@/lib/monte-defaults";

type TickerOption = { symbol: string; name: string };
type MarketDetail = {
  symbol: string;
  name?: string;
  price: number;
  currency: string;
  trailingPE?: number;
  forwardPE?: number;
  trailingEPS?: number;
};

type ModelMode = "realistic" | "historical" | "custom";
type RegimeMode = "full" | "balanced" | "recent";
type ScenarioId = "bear" | "base" | "bull";
type ScenarioInput = {
  id: ScenarioId;
  label: string;
  probability: number;
  expectedReturn: number;
  volatility: number;
  epsGrowth: number;
  epsVolatility: number;
  targetPE: number;
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
};

type MonteCarloResult = {
  p25: number[];
  median: number[];
  p75: number[];
  outerLow: number[];
  outerHigh: number[];
  samplePaths: number[][];
  terminalBins: Array<{ low: number; high: number; count: number }>;
  simulations: number;
  tradingDays: number;
  method: string;
  expectedBlockLength: number;
  confidenceLevel: number;
  percentileDefinitions: string;
  observationsUsed: number;
  medianTerminal: number;
  lowTerminal: number;
  highTerminal: number;
  p25Terminal: number;
  p75Terminal: number;
  medianGain: number;
  medianCagr: number;
  probabilityAboveTarget: number;
  probabilityMargin: number;
  probabilityBelowStart: number;
  probabilityGainOverTwenty: number;
  probabilityLossOverTwenty: number;
  probabilityOfGain: number;
  probabilityOfTenPercentLoss: number;
  medianMaxDrawdown: number;
  probabilityOfHalfLoss: number;
  medianTimeUnderwater: number;
  expectedShortfallReturn: number;
  scenarioShares: Record<string, number>;
  terminalPEMedian: number;
  probabilityAboveOneThousand: number;
};

const INITIAL_PROFILE = buildStockScenarioDefaults({
  symbol: "AAPL",
  historicalVolatility: 26,
  latestVolatility: 26,
  marketPE: null,
});

const HORIZONS = [
  { label: "1W", days: 5 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 1260 },
] as const;

const HISTORY_WINDOWS = [
  { label: "1Y", days: 252 },
  { label: "3Y", days: 756 },
  { label: "5Y", days: 1260 },
  { label: "MAX", days: 10000 },
] as const;

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function formatAxisPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function addMarketDays(date: Date, days: number, calendarMode: "trading" | "calendar") {
  const next = new Date(date);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    next.setDate(next.getDate() + 1);
    if (calendarMode === "calendar" || (next.getDay() !== 0 && next.getDay() !== 6)) remaining -= 1;
  }
  return next;
}

function formatDate(date: Date, horizon: number) {
  return new Intl.DateTimeFormat("en-ZA", horizon > 252
    ? { month: "short", year: "numeric" }
    : { day: "2-digit", month: "short", year: horizon > 63 ? "2-digit" : undefined }).format(date);
}

function clampHorizon(value: number) {
  return Math.min(1260, Math.max(5, Math.round(value)));
}

function ScenarioNumber({
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

export default function ForwardMonteCarloPanel({
  detail,
  loading: _loading,
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
  const configuredDefaultsRef = useRef("");
  const [tickerDraft, setTickerDraft] = useState(symbol);
  const [remoteTickerOptions, setRemoteTickerOptions] = useState<TickerOption[]>([]);
  const [horizon, setHorizon] = useState(63);
  const [horizonDraft, setHorizonDraft] = useState("63");
  const [modelMode, setModelMode] = useState<ModelMode>("realistic");
  const [scenarios, setScenarios] = useState<ScenarioInput[]>(INITIAL_PROFILE.scenarios.map((item) => ({ ...item })) as ScenarioInput[]);
  const [calibrationWindow, setCalibrationWindow] = useState(1260);
  const [regime, setRegime] = useState<RegimeMode>("balanced");
  const [simulations, setSimulations] = useState(20000);
  const [seed, setSeed] = useState(20260802);
  const [fatTails, setFatTails] = useState(true);
  const [degreesOfFreedom, setDegreesOfFreedom] = useState(6);
  const [jumpRisk, setJumpRisk] = useState(true);
  const [annualJumpProbability, setAnnualJumpProbability] = useState(25);
  const [meanReversionSpeed, setMeanReversionSpeed] = useState(0.55);
  const [currentPE, setCurrentPE] = useState(INITIAL_PROFILE.currentPE);
  const [peSource, setPESource] = useState<"market" | "manual fallback" | "manual" | "not supplied">("manual fallback");
  const [fundamentalAnchor, setFundamentalAnchor] = useState(INITIAL_PROFILE.useFundamentalAnchor);
  const [profileLabel, setProfileLabel] = useState(INITIAL_PROFILE.profileLabel);
  const [startingPrice, setStartingPrice] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [runNonce, setRunNonce] = useState(0);
  const [quoteRetryNonce, setQuoteRetryNonce] = useState(0);
  const [quoteState, setQuoteState] = useState<{
    symbol: string;
    detail: MarketDetail | null;
    loading: boolean;
    error: boolean;
  }>({ symbol: "", detail: null, loading: true, error: false });
  const [historyState, setHistoryState] = useState<{
    symbol: string;
    calibration: HistoryCalibration | null;
    error: boolean;
  }>({ symbol: "", calibration: null, error: false });
  const [simulationState, setSimulationState] = useState<{
    key: string;
    result: MonteCarloResult | null;
    progress: number;
    error: string;
  }>({ key: "", result: null, progress: 0, error: "" });

  const dashboardDetail = detail?.symbol === symbol && detail.price > 0 ? detail : null;
  const independentDetail = quoteState.symbol === symbol && quoteState.detail?.price
    ? quoteState.detail
    : null;
  const verifiedDetail = independentDetail || dashboardDetail;
  const quoteLoading = !verifiedDetail && (quoteState.symbol !== symbol || quoteState.loading);
  const quoteError = !verifiedDetail && quoteState.symbol === symbol && quoteState.error;
  const calibration = historyState.symbol === symbol ? historyState.calibration : null;
  const historyLoading = historyState.symbol !== symbol;
  const marketPE = verifiedDetail
    ? verifiedDetail.trailingPE
      || verifiedDetail.forwardPE
      || (verifiedDetail.trailingEPS && verifiedDetail.trailingEPS > 0 ? verifiedDetail.price / verifiedDetail.trailingEPS : null)
    : null;
  const tickerChoices = useMemo(() => [...tickerOptions, ...remoteTickerOptions]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index), [remoteTickerOptions, tickerOptions]);
  const probabilityTotal = scenarios.reduce((total, item) => total + item.probability, 0);
  const probabilitiesValid = Math.abs(probabilityTotal - 100) < 0.001;
  const calendarMode = calibration?.calendarMode || "trading";
  const forecastDate = useMemo(() => addMarketDays(new Date(), horizon, calendarMode), [calendarMode, horizon]);
  const expectedReturn = modelMode === "historical"
    ? (calibration?.annualizedReturn || 0)
    : scenarios.reduce((total, item) => total + item.expectedReturn * item.probability / 100, 0);
  const expectedVolatility = modelMode === "historical"
    ? (calibration?.annualizedVolatility || 0)
    : scenarios.reduce((total, item) => total + item.volatility * item.probability / 100, 0);
  const normalizedPE = scenarios.reduce((total, item) => total + item.targetPE * item.probability / 100, 0);
  const simulationReady = Boolean(
    verifiedDetail
    && calibration
    && startingPrice > 0
    && targetPrice > 0
    && (modelMode === "historical" || probabilitiesValid),
  );

  useEffect(() => setTickerDraft(symbol), [symbol]);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer = 0;
    let attempt = 0;
    const retryDelays = [0, 700, 1800, 3500];

    setQuoteState({ symbol, detail: null, loading: true, error: false });

    const loadQuote = async () => {
      try {
        const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=1D`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Quote request failed");
        const payload = await response.json() as MarketDetail;
        if (payload.symbol !== symbol || !Number.isFinite(payload.price) || payload.price <= 0) {
          throw new Error("Invalid quote response");
        }
        setQuoteState({ symbol, detail: payload, loading: false, error: false });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        attempt += 1;
        if (attempt < retryDelays.length) {
          retryTimer = window.setTimeout(loadQuote, retryDelays[attempt]);
          return;
        }
        setQuoteState({ symbol, detail: null, loading: false, error: true });
      }
    };

    loadQuote();
    return () => {
      controller.abort();
      window.clearTimeout(retryTimer);
    };
  }, [quoteRetryNonce, symbol]);

  useEffect(() => {
    const query = tickerDraft.trim();
    if (query.length < 2 || query.toUpperCase() === symbol) {
      setRemoteTickerOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/ticker-search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Ticker search failed");
          return response.json() as Promise<{ results?: TickerOption[] }>;
        })
        .then((payload) => setRemoteTickerOptions(Array.isArray(payload.results) ? payload.results : []))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setRemoteTickerOptions([]);
        });
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, tickerDraft]);

  useEffect(() => {
    if (!verifiedDetail) return;
    setStartingPrice(verifiedDetail.price);
    setTargetPrice(Number((verifiedDetail.price * 1.1).toFixed(2)));
  }, [symbol, verifiedDetail?.price, verifiedDetail?.symbol]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store", signal: controller.signal })
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
        ) throw new Error("Invalid history response");
        setHistoryState({ symbol, calibration: payload, error: false });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHistoryState({ symbol, calibration: null, error: true });
      });
    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    if (!calibration || calibration.requestedSymbol !== symbol || !verifiedDetail) return;
    const defaultsKey = `${symbol}:${marketPE ? marketPE.toFixed(4) : "no-pe"}`;
    if (configuredDefaultsRef.current === defaultsKey) return;
    const defaults = buildStockScenarioDefaults({
      symbol,
      historicalVolatility: calibration.annualizedVolatility,
      latestVolatility: calibration.latestAnnualizedVolatility,
      marketPE,
    });
    configuredDefaultsRef.current = defaultsKey;
    setScenarios(defaults.scenarios.map((item) => ({ ...item })) as ScenarioInput[]);
    setCurrentPE(Number(defaults.currentPE.toFixed(2)));
    setPESource(defaults.peSource as "market" | "manual fallback" | "not supplied");
    setFundamentalAnchor(defaults.useFundamentalAnchor);
    setProfileLabel(defaults.profileLabel);
    setModelMode("realistic");
    setFatTails(true);
    setJumpRisk(true);
    setDegreesOfFreedom(6);
    setAnnualJumpProbability(25);
    setMeanReversionSpeed(.55);
  }, [calibration, marketPE, symbol, verifiedDetail?.symbol]);

  const simulationKey = JSON.stringify({
    symbol,
    startingPrice,
    targetPrice,
    horizon,
    modelMode,
    scenarios,
    calibrationWindow,
    regime,
    simulations,
    seed,
    fatTails,
    degreesOfFreedom,
    jumpRisk,
    annualJumpProbability,
    meanReversionSpeed,
    currentPE,
    fundamentalAnchor,
    runNonce,
  });
  const result = simulationState.key === simulationKey ? simulationState.result : null;
  const progress = simulationState.key === simulationKey ? simulationState.progress : 0;

  useEffect(() => {
    if (!simulationReady || !calibration) {
      setSimulationState({ key: "", result: null, progress: 0, error: "" });
      return;
    }
    let worker: Worker | null = null;
    const timer = window.setTimeout(() => {
      const requestId = simulationKey;
      const activeWorker = new Worker("/monte-carlo-worker.js", { type: "module" });
      worker = activeWorker;
      setSimulationState({ key: requestId, result: null, progress: 0.02, error: "" });
      activeWorker.onmessage = (event: MessageEvent<{
        type: "progress" | "result" | "error";
        requestId: string;
        progress?: number;
        result?: MonteCarloResult;
        message?: string;
      }>) => {
        if (event.data.requestId !== requestId) return;
        if (event.data.type === "progress") {
          setSimulationState((current) => current.key === requestId
            ? { ...current, progress: event.data.progress || current.progress }
            : current);
        } else if (event.data.type === "result" && event.data.result) {
          setSimulationState({ key: requestId, result: event.data.result, progress: 1, error: "" });
          activeWorker.terminate();
        } else {
          setSimulationState({ key: requestId, result: null, progress: 0, error: event.data.message || "Simulation failed" });
          activeWorker.terminate();
        }
      };
      activeWorker.onerror = () => {
        setSimulationState({ key: requestId, result: null, progress: 0, error: "Simulation failed" });
        activeWorker.terminate();
      };
      activeWorker.postMessage({
        requestId,
        startingPrice,
        targetPrice,
        horizon,
        simulations,
        modelMode,
        scenarios: scenarios.map((item) => ({
          ...item,
          probability: item.probability / 100,
          expectedReturn: item.expectedReturn / 100,
          volatility: item.volatility / 100,
          epsGrowth: item.epsGrowth / 100,
          epsVolatility: item.epsVolatility / 100,
        })),
        historicalReturns: calibration.logReturns.slice(-calibrationWindow),
        returnRegimes: calibration.volatilityRegimes.slice(-calibrationWindow),
        currentVolatilityRegime: calibration.currentVolatilityRegime,
        periodsPerYear: calibration.periodsPerYear,
        historicalAnnualReturn: calibration.annualizedReturn / 100,
        seed,
        regime,
        currentPE,
        fundamentalAnchor,
        meanReversionSpeed,
        fatTails,
        degreesOfFreedom,
        jumpRisk,
        annualJumpProbability: annualJumpProbability / 100,
      });
    }, 260);
    return () => {
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [calibration, simulationKey, simulationReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result || !verifiedDetail) return;
    let visibleProgress = 0;
    let medianOpacity = 0;
    let frame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (pathProgress: number, greenOpacity: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      const padding = { top: 16, right: 84, bottom: 34, left: 12 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const plotRight = padding.left + chartWidth;
      const low = Math.min(...result.outerLow);
      const high = Math.max(...result.outerHigh);
      const spread = Math.max(high - low, startingPrice * 0.02);
      const minimum = Math.max(0, low - spread * 0.08);
      const maximum = high + spread * 0.08;
      const x = (index: number) => padding.left + index / (result.median.length - 1) * chartWidth;
      const y = (value: number) => padding.top + (maximum - value) / (maximum - minimum) * chartHeight;
      const visibleSteps = Math.max(1, Math.floor((result.median.length - 1) * pathProgress));
      context.clearRect(0, 0, width, height);

      context.strokeStyle = "rgba(255,255,255,.11)";
      context.lineWidth = 1;
      for (let line = 0; line < 4; line += 1) {
        const lineY = padding.top + line / 3 * chartHeight;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(plotRight, lineY);
        context.stroke();
        context.fillStyle = "rgba(255,255,255,.58)";
        context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textAlign = "left";
        context.textBaseline = line === 0 ? "top" : line === 3 ? "bottom" : "middle";
        context.fillText(formatAxisPrice(maximum - line / 3 * (maximum - minimum), verifiedDetail.currency), plotRight + 8, lineY);
      }

      const band = (upper: number[], lower: number[], color: string) => {
        context.beginPath();
        for (let index = 0; index <= visibleSteps; index += 1) {
          if (index === 0) context.moveTo(x(index), y(upper[index]));
          else context.lineTo(x(index), y(upper[index]));
        }
        for (let index = visibleSteps; index >= 0; index -= 1) context.lineTo(x(index), y(lower[index]));
        context.closePath();
        context.fillStyle = color;
        context.fill();
      };
      band(result.outerHigh, result.outerLow, "rgba(173,255,47,.08)");
      band(result.p75, result.p25, "rgba(173,255,47,.18)");

      context.strokeStyle = "rgba(255,255,255,.11)";
      context.lineWidth = 0.8;
      for (const path of result.samplePaths) {
        context.beginPath();
        for (let index = 0; index <= visibleSteps; index += 1) {
          if (index === 0) context.moveTo(x(index), y(path[index]));
          else context.lineTo(x(index), y(path[index]));
        }
        context.stroke();
      }

      if (targetPrice >= minimum && targetPrice <= maximum) {
        const targetY = y(targetPrice);
        context.setLineDash([5, 5]);
        context.strokeStyle = "rgba(255,194,92,.72)";
        context.beginPath();
        context.moveTo(padding.left, targetY);
        context.lineTo(plotRight, targetY);
        context.stroke();
        context.setLineDash([]);
      }

      if (greenOpacity > 0) {
        context.save();
        context.globalAlpha = greenOpacity;
        context.beginPath();
        result.median.forEach((value, index) => {
          if (index === 0) context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        });
        context.strokeStyle = "#adff2f";
        context.lineWidth = 2.4;
        context.stroke();
        context.restore();
      }

      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = "rgba(255,255,255,.52)";
      context.textBaseline = "bottom";
      [0, .25, .5, .75, 1].forEach((fraction, labelIndex) => {
        const step = Math.round((result.median.length - 1) * fraction);
        context.textAlign = labelIndex === 0 ? "left" : labelIndex === 4 ? "right" : "center";
        context.fillText(step === 0 ? "TODAY" : formatDate(addMarketDays(new Date(), step, calendarMode), horizon).toUpperCase(), x(step), height);
      });

      if (hoverIndexRef.current !== null && greenOpacity > 0) {
        const index = Math.min(visibleSteps, hoverIndexRef.current);
        const hoverX = x(index);
        const hoverY = y(result.median[index]);
        context.setLineDash([4, 4]);
        context.strokeStyle = "rgba(255,255,255,.48)";
        context.beginPath();
        context.moveTo(hoverX, padding.top);
        context.lineTo(hoverX, padding.top + chartHeight);
        context.stroke();
        context.setLineDash([]);
        const lines = [
          formatMoney(result.median[index], verifiedDetail.currency),
          index === 0 ? "Today" : `${formatDate(addMarketDays(new Date(), index, calendarMode), horizon)} · day ${index}`,
          `25–75%  ${formatAxisPrice(result.p25[index], verifiedDetail.currency)} – ${formatAxisPrice(result.p75[index], verifiedDetail.currency)}`,
          `5–95%   ${formatAxisPrice(result.outerLow[index], verifiedDetail.currency)} – ${formatAxisPrice(result.outerHigh[index], verifiedDetail.currency)}`,
        ];
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        const tooltipWidth = Math.max(180, ...lines.map((line) => context.measureText(line).width + 22));
        const tooltipHeight = 78;
        const tooltipX = hoverX + tooltipWidth + 14 > plotRight ? Math.max(4, hoverX - tooltipWidth - 12) : hoverX + 12;
        const tooltipY = Math.min(padding.top + chartHeight - tooltipHeight, Math.max(padding.top, hoverY - 39));
        context.fillStyle = "#f4f0e7";
        context.strokeStyle = "#adff2f";
        context.beginPath();
        context.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 5);
        context.fill();
        context.stroke();
        lines.forEach((line, lineIndex) => {
          context.fillStyle = lineIndex === 0 ? "#1d201b" : "rgba(29,32,27,.72)";
          context.font = lineIndex === 0
            ? "700 12px ui-monospace, SFMono-Regular, Menlo, monospace"
            : "9px ui-monospace, SFMono-Regular, Menlo, monospace";
          context.textAlign = "left";
          context.textBaseline = "alphabetic";
          context.fillText(line, tooltipX + 11, tooltipY + 19 + lineIndex * 17);
        });
      }
    };

    if (reduceMotion) {
      visibleProgress = 1;
      medianOpacity = 1;
      draw(1, 1);
    } else {
      const started = performance.now();
      const animate = (now: number) => {
        const elapsed = now - started;
        const pathProgress = Math.min(1, elapsed / 5500);
        visibleProgress = pathProgress < .5 ? 2 * pathProgress ** 2 : 1 - (-2 * pathProgress + 2) ** 2 / 2;
        medianOpacity = 1 - (1 - Math.min(1, Math.max(0, (elapsed - 5500) / 450))) ** 3;
        draw(visibleProgress, medianOpacity);
        if (elapsed < 5950) frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }

    const updateHover = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const chartWidth = rect.width - 96;
      const pointerX = Math.min(chartWidth, Math.max(0, event.clientX - rect.left - 12));
      hoverIndexRef.current = Math.round(pointerX / chartWidth * (result.median.length - 1));
      draw(visibleProgress, medianOpacity);
    };
    const clearHover = () => {
      hoverIndexRef.current = null;
      draw(visibleProgress, medianOpacity);
    };
    const observer = new ResizeObserver(() => draw(visibleProgress, medianOpacity));
    observer.observe(canvas);
    canvas.addEventListener("pointermove", updateHover);
    canvas.addEventListener("pointerdown", updateHover);
    canvas.addEventListener("pointerleave", clearHover);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", updateHover);
      canvas.removeEventListener("pointerdown", updateHover);
      canvas.removeEventListener("pointerleave", clearHover);
    };
  }, [calendarMode, horizon, result, startingPrice, targetPrice, verifiedDetail]);

  function selectModel(nextMode: ModelMode) {
    setModelMode(nextMode);
    if (nextMode === "realistic") {
      const defaults = buildStockScenarioDefaults({
        symbol,
        historicalVolatility: calibration?.annualizedVolatility,
        latestVolatility: calibration?.latestAnnualizedVolatility,
        marketPE,
      });
      setScenarios(defaults.scenarios.map((item) => ({ ...item })) as ScenarioInput[]);
      setCurrentPE(Number(defaults.currentPE.toFixed(2)));
      setPESource(defaults.peSource as "market" | "manual fallback" | "not supplied");
      setFundamentalAnchor(defaults.useFundamentalAnchor);
      setProfileLabel(defaults.profileLabel);
      setFatTails(true);
      setJumpRisk(true);
      setDegreesOfFreedom(6);
      setAnnualJumpProbability(25);
      setMeanReversionSpeed(.55);
    }
  }

  function updateScenario(id: ScenarioId, field: keyof Omit<ScenarioInput, "id" | "label">, value: number) {
    setScenarios((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
    setModelMode("custom");
  }

  function applyHorizon(event: FormEvent) {
    event.preventDefault();
    const next = clampHorizon(Number(horizonDraft) || 5);
    setHorizon(next);
    setHorizonDraft(String(next));
  }

  function applyTicker(event: FormEvent) {
    event.preventDefault();
    const query = tickerDraft.trim();
    const exactOption = tickerChoices.find((item) => (
      item.symbol.toUpperCase() === query.toUpperCase()
      || item.name.toLowerCase() === query.toLowerCase()
    ));
    const likelyOption = exactOption || (query.includes(" ")
      ? tickerChoices.find((item) => item.name.toLowerCase().includes(query.toLowerCase()))
      : undefined);
    const clean = likelyOption?.symbol
      || query.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24);
    if (clean) onSelectTicker(clean);
  }

  function downloadCsv() {
    if (!result) return;
    const rows = [
      "trading_day,date,p25,median,p75,outer_low,outer_high",
      ...result.median.map((median, day) => [
        day,
        addMarketDays(new Date(), day, calendarMode).toISOString().slice(0, 10),
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
    link.click();
    URL.revokeObjectURL(url);
  }

  const histogramMaximum = result ? Math.max(1, ...result.terminalBins.map((bin) => bin.count)) : 1;
  const warnings = [
    ...(horizon >= 1260 && result?.medianCagr && result.medianCagr > .15 ? ["Five-year median CAGR exceeds 15%."] : []),
    ...(horizon >= 1260 && result && result.medianTerminal > startingPrice * 3 ? ["Five-year median exceeds three times the starting price."] : []),
    ...(result && result.probabilityAboveOneThousand > .25 ? ["More than 25% of paths finish above $1,000."] : []),
    ...(modelMode === "historical" ? ["Historical return is being used as forward drift and may overstate growth."] : []),
    ...(!probabilitiesValid ? [`Scenario probabilities total ${probabilityTotal.toFixed(1)}%, not 100%.`] : []),
  ];

  return (
    <section className="monte-panel panel forward-monte">
      <div className="monte-heading">
        <div>
          <span className="eyebrow">PROBABILITY LAB</span>
          <h2>Monte Carlo simulator</h2>
          <p>Stock-specific volatility and forward scenarios for {verifiedDetail?.name || symbol}, with valuation anchoring only when reliable earnings data exists.</p>
        </div>
        <span className="simulation-badge">{profileLabel.toUpperCase()} · {simulations.toLocaleString()} PATHS</span>
      </div>

      <div className="monte-mode-selector" role="group" aria-label="Forecast model">
        {([
          ["realistic", "Realistic blended", "Default forward model"],
          ["historical", "Historical", "Comparison only"],
          ["custom", "Custom", "Edit every assumption"],
        ] as const).map(([value, label, note]) => (
          <button key={value} type="button" className={modelMode === value ? "active" : ""} onClick={() => selectModel(value)}>
            <strong>{label}</strong><small>{note}</small>
          </button>
        ))}
      </div>
      {modelMode === "historical" && <p className="monte-warning">Historical extrapolation — may overstate long-term growth</p>}
      {modelMode !== "historical" && !fundamentalAnchor && (
        <p className="monte-warning info">No reliable positive P/E was supplied for {symbol}. The default uses this stock&apos;s market-price process only; enter a valid P/E and enable the earnings anchor if appropriate.</p>
      )}

      <div className="monte-timeframe">
        <div className="monte-timeframe-heading">
          <span>FORECAST TIMEFRAME</span>
          <strong>{horizon.toLocaleString()} {calendarMode === "calendar" ? "calendar" : "trading"} days · through {formatDate(forecastDate, horizon)}</strong>
        </div>
        <div className="monte-presets" role="group" aria-label="Monte Carlo forecast timeframe">
          {HORIZONS.map((option) => (
            <button key={option.label} type="button" className={horizon === option.days ? "active" : ""} onClick={() => { setHorizon(option.days); setHorizonDraft(String(option.days)); }}>
              {option.label}
            </button>
          ))}
        </div>
        <form className="monte-custom-horizon" onSubmit={applyHorizon}>
          <label><input type="number" min="5" max="1260" value={horizonDraft} onChange={(event) => setHorizonDraft(event.target.value)} /><small>days</small></label>
          <button type="submit">Apply</button>
        </form>
      </div>

      <details className="monte-advanced" open={modelMode === "custom"}>
        <summary><span>Advanced model settings</span><small>Scenario weights, growth, volatility, valuation and tail risk</small></summary>
        <div className="monte-scenario-table">
          <div className="scenario-header"><span>Scenario</span><span>Probability</span><span>Price growth</span><span>Volatility</span><span>EPS growth</span><span>EPS σ</span><span>5Y P/E</span></div>
          {scenarios.map((scenario) => (
            <div className={`scenario-row ${scenario.id}`} key={scenario.id}>
              <strong>{scenario.label}</strong>
              <ScenarioNumber label="Probability" value={scenario.probability} suffix="%" min={0} max={100} onChange={(value) => updateScenario(scenario.id, "probability", value)} />
              <ScenarioNumber label="Price growth" value={scenario.expectedReturn} suffix="%" min={-50} max={50} step={.5} onChange={(value) => updateScenario(scenario.id, "expectedReturn", value)} />
              <ScenarioNumber label="Volatility" value={scenario.volatility} suffix="%" min={5} max={80} step={.5} onChange={(value) => updateScenario(scenario.id, "volatility", value)} />
              <ScenarioNumber label="EPS growth" value={scenario.epsGrowth} suffix="%" min={-20} max={30} step={.5} onChange={(value) => updateScenario(scenario.id, "epsGrowth", value)} />
              <ScenarioNumber label="EPS volatility" value={scenario.epsVolatility} suffix="%" min={0} max={30} step={.5} onChange={(value) => updateScenario(scenario.id, "epsVolatility", value)} />
              <ScenarioNumber label="Normalized P/E" value={scenario.targetPE} suffix="×" min={5} max={80} step={.5} onChange={(value) => updateScenario(scenario.id, "targetPE", value)} />
            </div>
          ))}
        </div>
        <div className={`probability-check ${probabilitiesValid ? "valid" : "invalid"}`}>
          Scenario probability total: <strong>{probabilityTotal.toFixed(1)}%</strong> {probabilitiesValid ? "✓" : "— must equal 100%"}
        </div>
        <div className="monte-advanced-grid">
          <ScenarioNumber label="CURRENT P/E" value={currentPE} suffix="×" min={1} max={100} step={.1} onChange={(value) => { setCurrentPE(value); setPESource("manual"); setFundamentalAnchor(true); setModelMode("custom"); }} />
          <ScenarioNumber label="MEAN REVERSION" value={meanReversionSpeed} suffix="speed" min={0} max={2} step={.05} onChange={(value) => { setMeanReversionSpeed(value); setModelMode("custom"); }} />
          <ScenarioNumber label="RANDOM SEED" value={seed} suffix="seed" min={1} max={4294967295} onChange={setSeed} />
          <ScenarioNumber label="STUDENT-T DF" value={degreesOfFreedom} suffix="df" min={5} max={30} onChange={(value) => { setDegreesOfFreedom(value); setModelMode("custom"); }} />
          <ScenarioNumber label="JUMP CHANCE" value={annualJumpProbability} suffix="% / yr" min={0} max={100} step={1} onChange={(value) => { setAnnualJumpProbability(value); setModelMode("custom"); }} />
          <ScenarioNumber label="SIMULATIONS" value={simulations} suffix="paths" min={1000} max={50000} step={1000} onChange={(value) => { setSimulations(value); setModelMode("custom"); }} />
          <label className="monte-toggle"><span>FAT TAILS</span><button type="button" className={fatTails ? "active" : ""} onClick={() => { setFatTails((value) => !value); setModelMode("custom"); }}>{fatTails ? "Student-t on" : "Normal only"}</button></label>
          <label className="monte-toggle"><span>JUMP RISK</span><button type="button" className={jumpRisk ? "active" : ""} onClick={() => { setJumpRisk((value) => !value); setModelMode("custom"); }}>{jumpRisk ? "Enabled" : "Disabled"}</button></label>
          <label className="monte-toggle"><span>EARNINGS / P-E ANCHOR</span><button type="button" className={fundamentalAnchor ? "active" : ""} onClick={() => { setFundamentalAnchor((value) => !value); setModelMode("custom"); }}>{fundamentalAnchor ? "Enabled" : "Price process only"}</button></label>
          <label className="monte-toggle"><span>HIGH ACCURACY</span><button type="button" className={simulations === 50000 ? "active" : ""} onClick={() => setSimulations(50000)}>Use 50,000 paths</button></label>
        </div>
      </details>

      <div className="monte-model-settings">
        <div className="monte-setting"><span>HISTORY WINDOW</span><div>{HISTORY_WINDOWS.map((item) => <button type="button" key={item.label} className={calibrationWindow === item.days ? "active" : ""} onClick={() => setCalibrationWindow(item.days)}>{item.label}</button>)}</div></div>
        <div className="monte-setting regime-setting"><span>HISTORICAL REGIME SAMPLE</span><div>{(["full", "balanced", "recent"] as RegimeMode[]).map((item) => <button type="button" key={item} className={regime === item ? "active" : ""} onClick={() => setRegime(item)}>{item === "full" ? "Full history" : item === "balanced" ? "Adaptive" : "Recent"}</button>)}</div></div>
        <div className="monte-setting"><span>OUTER BAND</span><div><button type="button" className="active">5th–95th</button></div></div>
      </div>

      <div className="monte-controls forward-controls">
        <form className="monte-ticker-search" onSubmit={applyTicker}>
          <span className="control-caption">TICKER</span>
          <div><input list="monte-ticker-options" value={tickerDraft} placeholder="Ticker or company name" onChange={(event) => setTickerDraft(event.target.value)} aria-label="Search any stock ticker or company for Monte Carlo" /><button type="submit">Load</button></div>
          <datalist id="monte-ticker-options">{tickerChoices.map((item) => <option value={item.symbol} key={item.symbol}>{item.name}</option>)}</datalist>
        </form>
        <label className="calibration-field"><span>FORWARD RETURN</span><div><strong>{expectedReturn.toFixed(1)}</strong><small>% annual</small></div></label>
        <label className="calibration-field"><span>SELECTED VOLATILITY</span><div><strong>{expectedVolatility.toFixed(1)}</strong><small>% annual</small></div></label>
        <label><span>TARGET PRICE</span><div><input type="number" min=".01" step=".01" value={targetPrice || ""} onChange={(event) => setTargetPrice(Number(event.target.value) || 0)} /><small>{verifiedDetail?.currency || "USD"}</small></div></label>
        <button type="button" disabled={!simulationReady} onClick={() => { if (verifiedDetail) setStartingPrice(verifiedDetail.price); setRunNonce((value) => value + 1); }}>Run with live price</button>
      </div>

      {simulationReady && result && verifiedDetail ? (
        <>
          <div className="monte-output">
            <div className="monte-chart-wrap">
              <div className="monte-chart-toolbar"><div className="monte-legend"><i /> Median <span className="inner-band" /> 25th–75th <span className="outer-band" /> 5th–95th</div><button type="button" onClick={downloadCsv}>↓ Export CSV</button></div>
              <canvas ref={canvasRef} className="monte-chart" aria-label={`${symbol} forecast with time below and ${verifiedDetail.currency} price on the right. Hover for percentile prices.`} />
            </div>
            <div className="monte-stats forecast-summary">
              <div><span>STARTING PRICE</span><strong>{formatMoney(startingPrice, verifiedDetail.currency)}</strong></div>
              <div><span>FORECAST HORIZON</span><strong>{horizon.toLocaleString()} days</strong></div>
              <div><span>MEDIAN ENDING PRICE</span><strong>{formatMoney(result.medianTerminal, verifiedDetail.currency)}</strong></div>
              <div><span>MEDIAN GAIN</span><strong>{(result.medianGain * 100).toFixed(1)}%</strong></div>
              <div><span>IMPLIED MEDIAN CAGR</span><strong>{(result.medianCagr * 100).toFixed(1)}%</strong></div>
              <div><span>25TH / 75TH</span><strong>{formatMoney(result.p25Terminal, verifiedDetail.currency)} — {formatMoney(result.p75Terminal, verifiedDetail.currency)}</strong></div>
              <div><span>5TH / 95TH</span><strong>{formatMoney(result.lowTerminal, verifiedDetail.currency)} — {formatMoney(result.highTerminal, verifiedDetail.currency)}</strong></div>
              <div><span>FINISH BELOW START</span><strong>{(result.probabilityBelowStart * 100).toFixed(1)}%</strong></div>
              <div><span>GAIN MORE THAN 20%</span><strong>{(result.probabilityGainOverTwenty * 100).toFixed(1)}%</strong></div>
              <div><span>LOSE MORE THAN 20%</span><strong>{(result.probabilityLossOverTwenty * 100).toFixed(1)}%</strong></div>
              <div><span>SELECTED MODEL</span><strong>{modelMode === "realistic" ? "Realistic blended" : modelMode === "historical" ? "Historical extrapolation" : "Custom"}</strong></div>
              <div><span>CURRENT → TERMINAL P/E</span><strong>{modelMode === "historical" || !fundamentalAnchor ? "Not applied" : `${currentPE.toFixed(1)}× → ${result.terminalPEMedian.toFixed(1)}×`}</strong></div>
            </div>
            <div className="monte-distribution">
              <div className="monte-distribution-heading"><div><span>TERMINAL OUTCOME DISTRIBUTION</span><strong>{formatDate(forecastDate, horizon)} · {result.simulations.toLocaleString()} paths</strong></div><small>Hover over a bar for its price range and path count.</small></div>
              <div className="monte-histogram" aria-label={`${symbol} simulated terminal price distribution`}>
                {result.terminalBins.map((bin, index) => <span key={`${bin.low}-${index}`} className={targetPrice >= bin.low && targetPrice <= bin.high ? "target" : ""} title={`${formatMoney(bin.low, verifiedDetail.currency)} – ${formatMoney(bin.high, verifiedDetail.currency)} · ${bin.count.toLocaleString()} paths`}><i style={{ height: `${Math.max(2, bin.count / histogramMaximum * 100)}%` }} /></span>)}
              </div>
              <div className="monte-distribution-axis"><span>{formatAxisPrice(result.terminalBins[0]?.low || result.lowTerminal, verifiedDetail.currency)}</span><span>Median {formatAxisPrice(result.medianTerminal, verifiedDetail.currency)}</span><span>{formatAxisPrice(result.terminalBins.at(-1)?.high || result.highTerminal, verifiedDetail.currency)}</span></div>
              <p><i /> Orange marks the bin containing your target price.</p>
            </div>
          </div>

          <div className="monte-assumption-summary">
            <div><span>SCENARIOS</span><strong>{modelMode === "historical" ? "Historical paths" : scenarios.map((item) => `${item.label} ${item.probability}%`).join(" · ")}</strong></div>
            <div><span>RETURN / VOLATILITY</span><strong>{expectedReturn.toFixed(1)}% / {expectedVolatility.toFixed(1)}%</strong></div>
            <div><span>VALUATION</span><strong>{fundamentalAnchor ? `${currentPE.toFixed(1)}× current (${peSource}) · ${normalizedPE.toFixed(1)}× probability-weighted target` : `Earnings anchor off · ${peSource}`}</strong></div>
          </div>

          <details className="monte-diagnostics">
            <summary>Model diagnostics</summary>
            <div className="diagnostic-grid">
              <div><span>HISTORICAL VOLATILITY</span><strong>{(calibration?.annualizedVolatility || 0).toFixed(1)}%</strong></div>
              <div><span>FORWARD EXPECTED RETURN</span><strong>{expectedReturn.toFixed(1)}%</strong></div>
              <div><span>HISTORICAL − FORWARD</span><strong>{((calibration?.annualizedReturn || 0) - expectedReturn).toFixed(1)}pp</strong></div>
              <div><span>CURRENT / NORMALIZED P/E</span><strong>{fundamentalAnchor ? `${currentPE.toFixed(1)}× / ${normalizedPE.toFixed(1)}×` : "Not applied"}</strong></div>
              <div><span>SIMULATED MEDIAN CAGR</span><strong>{(result.medianCagr * 100).toFixed(1)}%</strong></div>
              <div><span>SIMULATIONS / SEED</span><strong>{result.simulations.toLocaleString()} / {seed}</strong></div>
              <div><span>PERCENTILES</span><strong>5 / 25 / 50 / 75 / 95</strong></div>
              <div><span>PATHS BY SCENARIO</span><strong>{Object.entries(result.scenarioShares).map(([key, value]) => `${key} ${(value * 100).toFixed(1)}%`).join(" · ")}</strong></div>
              <div><span>PATHS ABOVE $1,000</span><strong>{(result.probabilityAboveOneThousand * 100).toFixed(2)}%</strong></div>
              <div><span>ENGINE</span><strong>{result.method}</strong></div>
            </div>
            {warnings.length > 0 && <div className="diagnostic-warnings">{warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}
          </details>
        </>
      ) : (
        <div className="monte-empty" role="status" aria-live="polite"><div><strong>{
          quoteLoading
            ? `Waiting for the verified ${symbol} live quote…`
            : quoteError
              ? `The verified ${symbol} live quote could not be loaded.`
            : historyLoading
              ? "Loading validated historical returns…"
              : historyState.error
                ? "Historical data is unavailable, so the simulation is disabled."
                : !probabilitiesValid && modelMode !== "historical"
                  ? `Scenario probabilities must total 100% (currently ${probabilityTotal.toFixed(1)}%).`
                  : simulationState.error
                    ? `The probability engine could not finish: ${simulationState.error}`
                    : `Calculating ${(progress * 100).toFixed(0)}% · ${simulations.toLocaleString()} paths in the background…`
        }</strong>{quoteError && <button type="button" onClick={() => setQuoteRetryNonce((value) => value + 1)}>Retry live quote</button>}{simulationReady && !simulationState.error && <span className="monte-progress"><i style={{ width: `${Math.max(3, progress * 100)}%` }} /></span>}</div></div>
      )}

      {calibration && <p className="monte-calibration">The {profileLabel.toLowerCase()} uses <b>{symbol}&apos;s own volatility and regimes</b> from {calibration.historySymbol} via {calibration.source}; historical return does not become forward drift. {calibration.logReturns.slice(-calibrationWindow).length.toLocaleString()} daily returns are loaded.</p>}
      <p className="monte-note">This is a probabilistic model, not a price target or guarantee. Long-term outcomes are highly sensitive to earnings growth and valuation assumptions.</p>
    </section>
  );
}
