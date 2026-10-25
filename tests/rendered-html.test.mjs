import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("the production build contains the revised forecasting interface", async () => {
  const source = await readFile(new URL("../app/MonteCarloPanel.tsx", import.meta.url), "utf8");
  const assets = await readdir(new URL("../dist/client/assets/", import.meta.url));
  assert.ok(assets.some((file) => file.endsWith(".js")));
  assert.match(source, /Monte Carlo simulator/);
  assert.match(source, /Realistic blended/);
  assert.match(source, /Historical extrapolation — may overstate long-term growth/);
  assert.match(source, /trading_day,date,p25,median,p75,outer_low,outer_high/);
  assert.match(source, /\/api\/market\?symbol=/);
  assert.match(source, /Retry live quote/);
  assert.match(source, /This is a probabilistic model, not a price target or guarantee/);
});

test("the dashboard contains the Congress disclosure monitor and its live API", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/congress-trades/route.ts", import.meta.url), "utf8");
  const membersRoute = await readFile(new URL("../app/api/congress-members/route.ts", import.meta.url), "utf8");
  const performanceRoute = await readFile(new URL("../app/api/congress-performance/route.ts", import.meta.url), "utf8");
  assert.match(page, /Congress<br \/>trade monitor/);
  assert.match(page, /A flagged trade is not proof of insider trading/);
  assert.match(page, /Verify official filing/);
  assert.match(route, /CapitolExposed/);
  assert.match(route, /Bargo Congress API/);
  assert.match(route, /disclosures-clerk\.house\.gov/);
  assert.match(route, /efdsearch\.senate\.gov/);
  assert.match(route, /Filed \$\{lagDays\} days after the transaction/);
  assert.match(page, /Most-watched congressional traders/);
  assert.match(page, /Stock move since latest buy/);
  assert.match(page, /Open \$\{position\.ticker\} chart/);
  assert.match(performanceRoute, /split\/dividend-adjusted close/);
  assert.match(performanceRoute, /next available market session/);
  assert.match(membersRoute, /duplicateRecordsRemoved/);
  assert.match(membersRoute, /seenTradeIds/);
  assert.match(page, /Full trade ledger/);
  assert.match(page, /ESTIMATE, NOT BROKERAGE HOLDINGS/);
  assert.match(membersRoute, /nancy-pelosi/);
  assert.match(membersRoute, /Positions are estimated from disclosed transaction-range midpoints/);
});
