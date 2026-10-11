"use client";
import { useEffect, useState } from "react";
import { api, categories, Category, Forecast, money } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import { SeriesChart } from "./charts";
type Insight = {
  forecast: Forecast;
  selected_model?: string;
  evaluation: {
    model: string;
    mae_cents: number;
    rmse_cents: number;
    wape: number | null;
    validation_points: number;
  }[];
  holdout?: {
    month: string;
    predicted_cents: number;
    actual_cents: number;
    absolute_error_cents: number;
  };
  trajectory: {
    day: number;
    observed_cents: number | null;
    projected_cents: number | null;
  }[];
  methodology: string;
  trajectory_note?: string;
  training_examples?: number;
  features?: string[];
};
export default function PredictiveWorkspace() {
  const store = useWorkspace(),
    [category, setCategory] = useState<Category>("Dining"),
    [date, setDate] = useState("2026-10-10"),
    [insight, setInsight] = useState<Insight | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!store.workspace) return;
    let active = true;
    const day = new Date(date + "T00:00:00Z");
    const horizon =
      new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
      ).getUTCDate() - day.getUTCDate();
    Promise.resolve()
      .then(() => {
        if (active) {
          setBusy(true);
          setError("");
        }
        return api<Insight>("/ml/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            as_of: date,
            horizon_days: horizon,
          }),
        });
      })
      .then((r) => {
        if (active) setInsight(r);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setInsight(null);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [store.workspace, store.revision, category, date, attempt]);
  const forecast = insight?.forecast,
    total = forecast?.predicted_period_total_cents,
    budget = forecast?.budget_cents;
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trained on your saved history</p>
            <h2>Predict your month</h2>
          </div>
          <span className="badge">Real model inference</span>
        </div>
        <div className="filter-row">
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Forecast date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
          <button
            className="secondary"
            onClick={() => setAttempt((v) => v + 1)}
            disabled={busy}
          >
            Refresh estimate
          </button>
        </div>
        {busy && (
          <p role="status" className="muted">
            Fitting, comparing and loading your forecast…
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {forecast?.data_quality !== "sufficient" && !busy && (
          <p className="empty">
            {forecast?.data_quality === "not_trained"
              ? "Forecasts are disabled."
              : "More history needed. Six consecutive active months and at least six category purchases are required."}
          </p>
        )}
        {forecast?.data_quality === "sufficient" && (
          <>
            <div className="metric-grid">
              <div className="metric">
                <span>Estimated remaining</span>
                <strong>
                  {money(forecast.forecast_remaining_cents || 0, "USD")}
                </strong>
              </div>
              <div className="metric">
                <span>Estimated month total</span>
                <strong>{money(total || 0, "USD")}</strong>
              </div>
              <div className="metric">
                <span>Monthly budget</span>
                <strong>
                  {budget == null ? "Not set" : money(budget, "USD")}
                </strong>
              </div>
            </div>
            {budget != null && total != null && (
              <p className={total > budget ? "warning" : "success"}>
                Estimated {money(Math.abs(budget - total), "USD")}{" "}
                {total > budget ? "over" : "under"} budget.
              </p>
            )}
            <SeriesChart
              forecast
              budget={budget}
              points={insight!.trajectory.map((p) => ({
                label: String(p.day),
                value: p.observed_cents,
                predicted: p.projected_cents,
              }))}
            />
            <p className="fine-print">{insight?.trajectory_note}</p>
            <p className="warning">
              Only six months of sparse history. No calibrated overrun
              probability or confidence interval is available. Purchases not
              imported are not included.
            </p>
          </>
        )}
      </section>
      {insight?.evaluation.length !== 0 && insight && (
        <section className="card">
          <div className="section-heading">
            <h2>Model evidence</h2>
            <span className="badge">
              Selected: {insight.selected_model?.replaceAll("_", " ")}
            </span>
          </div>
          <p className="muted">{insight.methodology}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Selection MAE</th>
                  <th>Selection RMSE</th>
                  <th>WAPE</th>
                  <th>Periods</th>
                </tr>
              </thead>
              <tbody>
                {insight.evaluation.map((e) => (
                  <tr key={e.model}>
                    <td>
                      {e.model.replaceAll("_", " ")}
                      {e.model === insight.selected_model ? " · selected" : ""}
                    </td>
                    <td>{money(e.mae_cents, "USD")}</td>
                    <td>{money(e.rmse_cents, "USD")}</td>
                    <td>
                      {e.wape == null
                        ? "Undefined (zero actual spend)"
                        : `${(e.wape * 100).toFixed(1)}% error`}
                    </td>
                    <td>{e.validation_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {insight.holdout && (
            <div className="info-note">
              <strong>Untouched final holdout · {insight.holdout.month}</strong>
              <p>
                Predicted remaining{" "}
                {money(insight.holdout.predicted_cents, "USD")} · actual{" "}
                {money(insight.holdout.actual_cents, "USD")} · absolute error{" "}
                {money(insight.holdout.absolute_error_cents, "USD")}.
              </p>
            </div>
          )}
          <p className="fine-print">
            MAE is mean absolute error; RMSE penalizes larger errors. WAPE is
            total absolute error divided by total absolute actual spending.
            These are errors, not accuracy percentages.{" "}
            {insight.training_examples} training examples; JSON model artifact
            persisted in PostgreSQL. Model version: {forecast?.model_version}.
          </p>
          <details className="fine-print">
            <summary>Features and methodology</summary>
            <p>{insight.features?.join(", ").replaceAll("_", " ")}</p>
            <p>
              Budgets are compared after inference, rather than used as
              predictors, because historical budget values are unavailable. No
              neural network or risk classifier is justified by this small
              dataset.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
