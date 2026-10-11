"use client";
import { useEffect, useState } from "react";
import { api, categories, Category, Forecast, money } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import { SeriesChart } from "./charts";

const modelNames: Record<string, string> = {
  daily_mean: "Historical daily average", previous_month: "Previous month’s total",
  linear: "Spending-pattern regression", ridge: "Smoothed spending-pattern regression",
  random_forest: "Combined decision trees", gradient_boosting: "Refined decision trees",
};
const modelMeaning: Record<string, string> = {
  daily_mean: "Uses the average spending per day in earlier months.",
  previous_month: "Uses the previous month’s total as a target, then subtracts spending recorded so far this month, with a minimum remaining estimate of $0.",
  linear: "Looks for relationships between spending so far, time remaining, and earlier spending patterns.",
  ridge: "Looks for those relationships while reducing the influence of unstable patterns in a small sample.",
  random_forest: "Combines several sets of spending-pattern rules into one estimate.",
  gradient_boosting: "Builds spending-pattern rules in stages, with later rules correcting earlier misses.",
};
const modelName = (name: string) => modelNames[name] || name.replaceAll("_", " ");
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
    budget = forecast?.budget_cents,
    remaining = forecast?.forecast_remaining_cents ?? 0,
    recorded = (total ?? 0) - remaining,
    selected = insight?.evaluation.find(e => e.model === insight.selected_model);
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trained on your saved history</p>
            <h2>Predict your month</h2>
          </div>
          <span className="badge">Spending estimate</span>
        </div>
        <p className="muted">How much more might you spend before month-end? Choose one category and a date. We use earlier spending patterns to estimate purchases after that date, then compare the estimated month total with your budget.</p>
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
        <p className="muted">The forecast date is your starting point: recorded spending includes that date; the estimate covers the following day through the last day of the same month. Refresh estimate recalculates from your saved records.</p>
        {busy && (
          <p role="status" className="muted">
            Comparing past spending patterns and preparing your estimate…
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {forecast && forecast.data_quality !== "sufficient" && !busy && (
          <p className="empty">
            {forecast?.data_quality === "not_trained"
              ? "Forecasts are disabled."
              : "More history needed. Six consecutive active months and at least six category purchases are required."}
          </p>
        )}
        {forecast?.data_quality === "sufficient" && !busy && (
          <>
            <div className="info-note">
              <strong>{category} · {date} through month-end</strong>
              <p>You have {money(recorded, "USD")} recorded this month through {date}. We estimate another {money(remaining, "USD")} after that date, bringing the month’s estimated total to {money(total ?? 0, "USD")}.</p>
              <p className="muted">Recorded spending comes only from imported purchases and refunds. A recorded total of $0 does not prove you have spent nothing.</p>
            </div>
            <div className="metric-grid">
              <div className="metric">
                <span>Estimated remaining spending</span>
                <strong>
                  {money(forecast.forecast_remaining_cents || 0, "USD")}
                </strong>
                <small>Additional spending after {date}, through month-end. This is the amount being predicted.</small>
              </div>
              <div className="metric">
                <span>Estimated month total</span>
                <strong>{money(total || 0, "USD")}</strong>
                <small>{money(recorded, "USD")} recorded so far + {money(remaining, "USD")} estimated remaining.</small>
              </div>
              <div className="metric">
                <span>Monthly budget</span>
                <strong>
                  {budget == null ? "Not set" : money(budget, "USD")}
                </strong>
                <small>Your spending limit for this category and month. Set or change it in Budgets & Goals; it is not a prediction.</small>
              </div>
            </div>
            {budget != null && total != null && (
              <p className={total > budget ? "warning" : "success"}>
                {total === budget ? "Estimated to meet your budget." : `Estimated ${money(Math.abs(budget - total), "USD")} ${total > budget ? "over" : "under"} budget.`} This compares the estimated month total with your limit; it is not a guarantee.
              </p>
            )}
            <div className="forecast-explainer"><h3>Reading the spending chart</h3>
              <p className="muted">Left to right: days of the selected month. Bottom to top: total spending accumulated since the month began, in USD.</p>
              <ul className="chart-key">
                <li><span className="line-key recorded" />Solid teal: recorded spending through your chosen date.</li>
                <li><span className="line-key predicted" />Dashed blue: the estimated path to the month’s total.</li>
                {budget != null && <li><span className="line-key limit" />Dashed gold: your monthly budget.</li>}
              </ul>
            </div>
            <SeriesChart
              forecast
              budget={budget}
              points={insight!.trajectory.map((p) => ({
                label: String(p.day),
                value: p.observed_cents,
                predicted: p.projected_cents,
              }))}
            />
            <p className="muted">The blue line spreads the remaining estimate evenly across the remaining days to illustrate the total. It does not predict which days you will shop or how much each purchase will cost. You can open the chart’s data table to see the amounts.</p>
            <p className="warning">
              This estimate uses a small amount of history, with few purchases. Actual spending may be very different. We cannot reliably give the chance of going over budget or a likely best-to-worst range. Missing purchases are not included.
            </p>
          </>
        )}
      </section>
      {insight?.evaluation.length !== 0 && insight && !busy && (
        <section className="card">
          <div className="section-heading">
            <h2>How was this estimate chosen?</h2>
            <span className="badge">
              {insight.selected_model && modelName(insight.selected_model)}
            </span>
          </div>
          <p className="muted">We compared six ways to predict remaining spending, testing them on earlier months before choosing the one with the smallest average dollar miss. The tests use past spending to predict later spending, so future purchases are not used to make earlier predictions.</p>
          {insight.selected_model && <p className="info-note"><strong>Chosen approach: {modelName(insight.selected_model)}.</strong> {modelMeaning[insight.selected_model]} {selected && <>In {selected.validation_points} earlier test periods, its predictions missed by an average of {money(selected.mae_cents, "USD")}. That describes past errors, not how far this new estimate is guaranteed to miss.</>}</p>}
          <div className="forecast-explainer"><h3>What the comparison numbers mean</h3>
            <ul className="explanation-list">
              <li><strong>Average dollar miss (MAE):</strong> how far predictions were from recorded spending, on average, ignoring whether they were too high or too low. A $5 miss means predictions differed by about $5 in those tests.</li>
              <li><strong>Large-miss score (RMSE):</strong> another dollar error score that gives bigger mistakes more weight. Lower is better for both dollar scores.</li>
              <li><strong>Error relative to spending (WAPE):</strong> total dollar misses divided by total recorded spending in the tests. 20% means $20 of error for every $100 recorded; it does not mean 80% accuracy. It cannot be calculated when actual spending totals zero.</li>
              <li><strong>Test periods:</strong> how many past prediction checks were used to choose the approach. Few tests provide limited evidence.</li>
            </ul>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Approach</th>
                  <th>Average dollar miss (MAE)</th>
                  <th>Large-miss score (RMSE)</th>
                  <th>Error relative to spending (WAPE)</th>
                  <th>Test periods</th>
                </tr>
              </thead>
              <tbody>
                {insight.evaluation.map((e) => (
                  <tr key={e.model}>
                    <td>
                      {modelName(e.model)}
                      {e.model === insight.selected_model ? " · selected" : ""}
                    </td>
                    <td>{money(e.mae_cents, "USD")}</td>
                    <td>{money(e.rmse_cents, "USD")}</td>
                    <td>
                      {e.wape == null
                        ? "Not available: actual spending was $0"
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
              <strong>A separate check on an unseen month · {insight.holdout.month}</strong>
              <p>This month was kept out of the approach-selection tests. We checked its remaining spending after the same day-of-month cutoff; these amounts are not full-month totals.</p>
              <p>
                Predicted remaining{" "}
                {money(insight.holdout.predicted_cents, "USD")} · actual{" "}
                {money(insight.holdout.actual_cents, "USD")} · absolute error{" "}
                {money(insight.holdout.absolute_error_cents, "USD")}.
              </p>
              <p className="muted">One check cannot prove reliability. A $0 miss may simply mean there were no recorded purchases after the cutoff.</p>
            </div>
          )}
          <details className="fine-print">
            <summary>Optional technical details</summary>
            <p>{insight.methodology}</p>
            <p>{insight.training_examples} training examples. Model version: {forecast?.model_version}.</p>
            <p>Inputs used to find patterns:</p>
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
