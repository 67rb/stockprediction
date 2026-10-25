# Monte Carlo model validation

Validated on 2026-08-02 with AAPL starting at $308.91, seed `20260802`, 20,000 paths, and the default forward assumptions documented in the project README.

The implementation is not restricted to AAPL. AAPL retains the specification's fixed validation profile, while every other searchable stock receives volatility assumptions derived from its own history. MSFT, NVDA and TSLA are included in cross-stock regression coverage. A positive market P/E enables the fundamental anchor; otherwise the default remains price-only so that the model does not fabricate positive earnings for an unprofitable or unclassified company.

## Original modeling fault

The previous stationary bootstrap repeatedly sampled Apple's historical log returns. That preserved useful volatility clustering and tails, but it also made Apple's unusually strong realised historical growth the default forward drift. The old engine used only 2,000 paths at 1,260 trading days, increasing quantile noise. It did not independently model forward return, EPS growth, or valuation normalization.

## Corrected implementation

- Arithmetic annual price-growth assumptions are converted with `(ln(1 + return) - 0.5 × volatility²) / 252`.
- Daily volatility is `annual volatility / sqrt(252)`.
- Forward returns come from editable bear/base/bull assumptions; historical returns do not supply default drift.
- Student-t innovations, persistent volatility states, downside-sensitive regime transitions, and asymmetric jumps model tail risk.
- EPS grows from bounded annual draws and P/E moves smoothly toward scenario-specific five-year levels.
- A smooth fundamental weight blends the market and EPS/P-E paths over approximately three years.
- Percentiles are computed directly from every simulated path.

## Fixed-seed regression result

| Horizon | Old p25 | Old median | Old p75 | New p25 | New median | New p75 | New p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 63 days | $296.01 | $325.11 | $357.22 | $281.28 | $312.05 | $345.27 | $399.49 |
| 504 days | $349.40 | $453.74 | $587.82 | $317.27 | $362.77 | $406.14 | $479.30 |
| 1,260 days | $538.30 | $833.78 | $1,279.35 | $375.02 | $473.80 | $576.44 | $779.22 |

The five-year median falls from 2.70× starting price to 1.53× without a price cap. In this deterministic run, 0.02% of paths finish above $1,000, so that outcome remains possible but is a rare tail event.

## Validation assessment

Ready to share with caveats. The calculations, seeded reproducibility, schema, and broad regression ranges pass. P/E availability depends on fields exposed by the existing Yahoo chart response; the UI clearly uses a manual 28× fallback when unavailable. Scenario probabilities and valuation inputs are model assumptions, not consensus estimates or guarantees.
