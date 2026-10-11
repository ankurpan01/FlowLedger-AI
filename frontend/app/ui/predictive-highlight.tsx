"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, money, Forecast } from "@/lib/api";

import { useWorkspace } from "./workspace-provider";
export default function PredictiveHighlight() {
  const store = useWorkspace(),
    [forecast, setForecast] = useState<Forecast | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!store.workspace) return;
    let active = true;
    api<Forecast>("/ml/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "Dining",
        as_of: "2026-10-10",
        horizon_days: 21,
      }),
    })
      .then((r) => {
        if (active) {
          setForecast(r);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError("Forecast unavailable. Open Predictions to retry.");
      });
    return () => {
      active = false;
    };
  }, [store.workspace, store.revision]);
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Predictive highlight</p>
          <h2>Dining · October 2026</h2>
        </div>
        <Link className="text-link" href="/predictions">
          Understand this estimate ↗
        </Link>
      </div>
      {forecast?.data_quality === "sufficient" ? (
        <>
          <p className="forecast-highlight">
            Estimated month total{" "}
            <strong>
              {money(forecast.predicted_period_total_cents || 0, "USD")}
            </strong>
          </p>
          <p className="muted">
            As of October 10 · budget{" "}
            {forecast.budget_cents == null
              ? "not set"
              : money(forecast.budget_cents, "USD")}{" "}
            · average miss in past tests: {forecast.backtest_mae_cents == null ? "not available" : money(forecast.backtest_mae_cents, "USD")}.
          </p>
          <p className="fine-print">
            The month total adds recorded spending through October 10 to estimated spending for October 11–31. The average miss measures past errors, not a guaranteed margin for this prediction.{" "}
            Limited history; this is an estimate, not a guarantee. The
            reporting-month cards above show recorded spending.
          </p>
        </>
      ) : (
        <p className="muted">
          {error ||
            (forecast
              ? "More saved history is needed for this forecast."
              : "Loading your forecast…")}
        </p>
      )}
    </section>
  );
}
