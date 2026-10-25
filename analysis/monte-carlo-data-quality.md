# Monte Carlo historical pack — data quality report

Generated: 2026-08-02T14:15:27.778Z

## Dataset and intended grain

- Source archive: `Ledger-Monte-Carlo-Historical-Data-Pack-2026-08-02 (1).zip`
- SHA-256: `5737987f5652d5f462dfa7d452a1cf8a7bceb6e822c14b1e1c428d24cdd8b668`
- Intended use: single-asset daily return bootstrapping and regime-conditioned Monte Carlo; realistic paper-trading spread defaults for ten equities.
- Raw grain inspected: 614,538 active-market H1 bars across 16 assets.
- Model grain produced: 46,257 UTC daily log returns.

## Checks performed

- Verified the outer pack and every nested archive checksum supplied by the pack.
- Reconciled manifest row counts to parsed H1 files.
- Checked the supplied duplicate-timestamp, chronology, OHLC, and negative-volume audits.
- Corrected known stock splits from the included corporate-action file before calculating returns.
- Rejected non-finite returns and moves outside conservative asset-specific validity bounds.
- Built rolling 21-observation volatility regimes without using future observations.
- Reduced ten-equity BID/ASK histories into typical and stressed spread profiles.

## Findings

| Ticker | Start | End | Returns | Splits corrected | Returns excluded | Largest retained move |
|---|---:|---:|---:|---:|---:|---:|
| AAPL | 2017-01-27 | 2026-07-28 | 2,387 | 1 | 0 | 14.9% |
| NVDA | 2017-01-27 | 2026-07-28 | 2,387 | 2 | 0 | 24.4% |
| GOOG | 2017-01-27 | 2026-07-28 | 2,387 | 1 | 0 | 13.3% |
| MSFT | 2017-01-27 | 2026-07-28 | 2,387 | 0 | 0 | 17.5% |
| AMZN | 2017-01-27 | 2026-07-28 | 2,387 | 1 | 0 | 16.7% |
| AVGO | 2017-01-27 | 2026-07-28 | 2,387 | 1 | 0 | 24.8% |
| META | 2017-01-27 | 2026-07-28 | 2,387 | 0 | 0 | 35.9% |
| TSLA | 2017-01-27 | 2026-07-28 | 2,387 | 2 | 0 | 26.7% |
| MU | 2017-11-03 | 2026-07-28 | 2,192 | 0 | 0 | 24.9% |
| BRK-B | 2017-11-07 | 2026-07-28 | 2,190 | 0 | 0 | 12% |
| ^GSPC | 2012-01-18 | 2026-07-28 | 4,252 | 0 | 0 | 12% |
| ^NDX | 2012-01-20 | 2026-07-28 | 4,239 | 0 | 0 | 13.6% |
| BTC-USD | 2017-05-08 | 2026-07-28 | 3,193 | 0 | 0 | 63.2% |
| ETH-USD | 2017-12-12 | 2026-07-28 | 3,006 | 0 | 0 | 78.7% |
| SOL-USD | 2024-03-24 | 2026-07-28 | 855 | 0 | 0 | 25.8% |
| XAUUSD | 2003-05-06 | 2026-07-28 | 7,234 | 0 | 0 | 11.1% |

- 0 return observations were excluded across all assets after split correction.
- The source validation reports show zero duplicate timestamps, out-of-order rows, invalid OHLC rows, or negative-volume rows.
- The stock histories are Dukascopy CFD quotes, not consolidated exchange prints. This is a medium-severity basis risk for exact execution studies, but acceptable for broad return-shape and spread-scenario calibration.
- Daily returns use midpoint closes and correct splits, but do not add dividends. Long-horizon equity drift is therefore price-return rather than total-return drift.
- Crypto uses 365 observations per year; exchange-traded instruments use 252.

## Downstream safeguards

- Unsupported tickers continue using the existing Yahoo adjusted-daily fallback.
- The simulator receives an explicit source, coverage window, observation count, annualization basis, and current volatility regime.
- The raw 161 MB archive is not shipped to the website; only compact derived calibration arrays and spread summaries are bundled.
- Historical results are research inputs, not evidence of a future trading edge.
