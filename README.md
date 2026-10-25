# Ledger Market Dashboard

Ledger is a privately hosted market dashboard with live Yahoo Finance quotes, interactive charts, watchlists, news, market discovery, historical-data downloads, portfolio analysis, paper trading, and a configurable Monte Carlo forecast.

## Monte Carlo model for global stocks

The ticker search accepts any listing available through the existing Yahoo search and history source. The default forecast is a forward-looking scenario mixture rather than an extrapolation of a stock's historical CAGR. Each selected stock loads its own daily history to calibrate realised volatility, volatility regimes, downside behaviour, and the optional historical comparison mode.

Apple retains the originally validated assumptions:

| Scenario | Probability | Annual price growth | Volatility | EPS growth ± σ | Five-year P/E |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bear | 25% | 3% | 32% | 3% ± 6% | 22× |
| Base | 50% | 10% | 26% | 9% ± 5% | 28× |
| Bull | 25% | 17% | 29% | 14% ± 6% | 34× |

Every other stock receives an adaptive profile:

- Bear/base/bull forward price-growth assumptions of 1%/8%/15%.
- Volatility derived from a blend of that stock's long-run and recent realised volatility, with transparent guardrails.
- A fundamental EPS/P-E anchor only when the market source supplies a reliable positive P/E.
- No invented earnings multiple for companies with negative earnings or missing valuation data. Those stocks default to the stock-specific market-price process; a user may enter a manual P/E and explicitly enable the anchor.
- Editable scenario probabilities, returns, volatility, EPS growth and normalized multiples for company-specific research.

The price process uses volatility-adjusted GBM log drift, Student-t innovations with six degrees of freedom, persistent normal/high-volatility regimes, and asymmetric jump risk. After the short term, a smooth EPS-and-P/E fundamental anchor increasingly influences price. P/E mean reverts continuously rather than changing immediately. Annual EPS growth draws are limited to -20% through +30%; there is no stock-price cap.

The UI defaults to 20,000 deterministic paths and offers a 50,000-path high-accuracy mode. The chart's outer band is always the 5th–95th percentile calculated from all paths. The CSV schema remains:

`trading_day,date,p25,median,p75,outer_low,outer_high`

The historical bootstrap remains available as `Historical extrapolation — may overstate long-term growth`.

## Local validation

```bash
npm test
```

Tests cover financial-math conversions, scenario allocation, adaptive stock defaults, P/E reversion, price-only behavior without a P/E, seeded reproducibility, percentiles, positive finite outputs, multi-stock runs, trading-day counts, CAGR, CSV compatibility, and broad AAPL statistical regression ranges.

## Important limitation

This is a probabilistic model, not a price target or guarantee. Long-term outcomes are highly sensitive to earnings growth and valuation assumptions. The dashboard uses a market-supplied P/E when the existing quote source provides one; otherwise it displays and permits editing of a manual fallback.
