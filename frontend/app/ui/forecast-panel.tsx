"use client";

import { useEffect, useState } from "react";
import { api, Forecast, money } from "@/lib/api";

export function ForecastResult({ forecast }: { forecast: Forecast }) {
  if (forecast.data_quality !== "sufficient") {
    return <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900">{forecast.data_quality === "not_trained" ? "Forecast model is not trained or enabled." : "More data needed. Import six consecutive months of history with at least six transactions in this category."}</p>;
  }
  const total = forecast.predicted_period_total_cents;
  const budget = forecast.budget_cents;
  const gap = total !== null && budget !== null ? budget - total : null;
  return <div className="mt-4 space-y-4">
    <p className="text-sm text-slate-600">{forecast.category} estimate as of {forecast.as_of} · {forecast.horizon_days} days remaining · USD</p>
    <div className="grid gap-4 sm:grid-cols-3">{[
      ["Estimated remaining spending", forecast.forecast_remaining_cents],
      ["Spent to date + estimate", total], ["Monthly budget", budget],
    ].map(([label, cents]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-2xl font-semibold">{typeof cents === "number" ? money(cents, "USD") : "Not configured"}</p></div>)}</div>
    <p className={`rounded-xl p-4 font-medium ${gap !== null && gap < 0 ? "bg-amber-50 text-amber-900" : "bg-teal-50 text-teal-900"}`}>
      {gap === null ? "Set a budget before comparing." : gap < 0 ? `Estimated ${money(-gap, "USD")} over budget.` : gap === 0 ? "Estimated to meet the budget exactly." : `Estimated ${money(gap, "USD")} under budget.`}
    </p>
    <p className="text-sm text-slate-600">Based on six months of saved history. Sparse purchases limit this estimate. Historical average forecast error: {forecast.backtest_mae_cents !== null ? money(forecast.backtest_mae_cents, "USD") : "unavailable"}. This is not a guarantee or a confidence interval.</p>
    {forecast.horizon_days > 0 && forecast.backtest_mae_cents !== null && forecast.forecast_remaining_cents !== null && forecast.backtest_mae_cents >= forecast.forecast_remaining_cents / 2 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Historical error is large relative to this estimate. Treat the budget comparison cautiously.</p>}
    <p className="text-sm text-slate-500">Spending to date includes only imported records. Missing purchases are not included.</p>
  </div>;
}

export default function ForecastPanel({ revision }: { revision: number }) {
  const [asOf, setAsOf] = useState("2026-10-10");
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${asOf}:${revision}:${refresh}`;
  const [response, setResponse] = useState<{ key: string; forecast: Forecast | null; error: string } | null>(null);
  const busy = Boolean(asOf) && response?.key !== requestKey;
  const forecast = response?.key === requestKey ? response.forecast : null;
  const error = response?.key === requestKey ? response.error : "";
  useEffect(() => {
    let active = true;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
    if (!match) return;
    const [, year, month, day] = match.map(Number);
    const horizon = new Date(Date.UTC(year, month, 0)).getUTCDate() - day;
    api<Forecast>("/ml/forecast", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Dining", as_of: asOf, horizon_days: horizon }),
    }).then(result => { if (active) setResponse({ key: requestKey, forecast: result, error: "" }); })
      .catch(problem => { if (active) setResponse({ key: requestKey, forecast: null, error: problem instanceof Error ? problem.message : "Unable to load forecast." }); });
    return () => { active = false; };
  }, [asOf, requestKey]);
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="forecast-title">
    <h2 id="forecast-title" className="text-lg font-semibold">Dining forecast &amp; budget</h2>
    <p className="mt-1 text-sm text-slate-600">An estimate of spending after the selected date through the end of its month.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-sm font-medium">Forecast date<input type="date" required value={asOf} onChange={event => setAsOf(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2" /></label><button type="button" disabled={busy || !asOf} onClick={() => setRefresh(value => value + 1)} className="rounded-xl bg-teal-800 px-5 py-2.5 font-semibold text-white disabled:opacity-50">Refresh estimate</button></div>
    {busy && <p role="status" className="mt-4 text-sm text-teal-800">Calculating from saved history…</p>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {forecast && <ForecastResult forecast={forecast} />}
  </section>;
}
