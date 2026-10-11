"use client";
import { useState } from "react";
import { Category, money, Transaction } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
const palette = [
  "#009b8b",
  "#0c534e",
  "#367d83",
  "#7cb8b1",
  "#426c95",
  "#89a7bb",
  "#bfd9d3",
  "#d0b589",
];
export function Donut({
  rows,
}: {
  rows: { category: Category; amount_cents: number }[];
}) {
  const { category, setCategory } = useWorkspace();
  const positive = rows.filter((r) => r.amount_cents > 0),
    total = positive.reduce((s, r) => s + r.amount_cents, 0);
  return (
    <div className="donut-layout">
      <div className="donut-wrap">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`Positive spending distribution. Total ${money(total, "USD")}`}
        >
          <circle
            cx="100"
            cy="100"
            r="72"
            fill="none"
            stroke="#eef3f5"
            strokeWidth="28"
          />
          {positive.map((r, i) => {
            const percent = r.amount_cents / total,
              length = percent * 452.389,
              offset =
                (positive.slice(0, i).reduce((s, p) => s + p.amount_cents, 0) /
                  total) *
                452.389;
            return (
              <circle
                key={r.category}
                cx="100"
                cy="100"
                r="72"
                fill="none"
                stroke={palette[i % palette.length]}
                strokeWidth={category === r.category ? 34 : 28}
                strokeDasharray={`${length} ${452.389 - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
              >
                <title>
                  {r.category}: {money(r.amount_cents, "USD")} ·{" "}
                  {(percent * 100).toFixed(1)}%
                </title>
              </circle>
            );
          })}
          <text x="100" y="94" textAnchor="middle" className="chart-label">
            Spending
          </text>
          <text x="100" y="118" textAnchor="middle" className="chart-value">
            {money(total, "USD")}
          </text>
        </svg>
      </div>
      <div className="chart-legend">
        {positive.map((r, i) => (
          <button
            key={r.category}
            aria-pressed={category === r.category}
            onClick={() =>
              setCategory(category === r.category ? "" : r.category)
            }
          >
            <span style={{ background: palette[i % palette.length] }} />
            <strong>{r.category}</strong>
            <span>{money(r.amount_cents, "USD")}</span>
            <small>{((r.amount_cents / total) * 100).toFixed(1)}%</small>
          </button>
        ))}
        {!total && (
          <p className="muted">No positive spending in this period.</p>
        )}
        <p className="fine-print">
          Distribution uses positive net category totals. Refunds are included
          in the overall net total.
        </p>
      </div>
    </div>
  );
}
export function SeriesChart({
  points,
  budget,
  forecast = false,
}: {
  points: { label: string; value: number | null; predicted?: number | null }[];
  budget?: number | null;
  forecast?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null),
    values = points.flatMap((p) => [p.value || 0, p.predicted || 0]);
  const max = Math.max(1, budget || 0, ...values),
    min = Math.min(0, ...values),
    range = max - min;
  const x = (i: number) => 45 + (i * 650) / Math.max(1, points.length - 1),
    y = (v: number) => 180 - ((v - min) / range) * 145;
  const path = (key: "value" | "predicted") =>
    points.reduce((s, p, i) => {
      const v = p[key];
      if (v == null) return s;
      return (
        s +
        `${i === 0 || points[i - 1][key] == null ? "M" : "L"}${x(i)},${y(v)} `
      );
    }, "");
  return (
    <div className="series-chart">
      <svg
        viewBox="0 0 730 225"
        role="img"
        aria-label={
          forecast
            ? "Observed and projected cumulative spending"
            : "Spending over time"
        }
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="45"
              x2="705"
              y1={y(min + range * v)}
              y2={y(min + range * v)}
              stroke="#e8eef2"
            />
            <text
              x="40"
              y={y(min + range * v) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#658091"
            >
              {money(Math.round(min + range * v), "USD")}
            </text>
          </g>
        ))}
        {budget != null && (
          <g>
            <line
              x1="45"
              x2="705"
              y1={y(budget)}
              y2={y(budget)}
              stroke="#b98722"
              strokeDasharray="6 5"
            />
            <text
              x="700"
              y={y(budget) - 6}
              textAnchor="end"
              fontSize="11"
              fill="#966619"
            >
              Budget
            </text>
          </g>
        )}
        <path d={path("value")} fill="none" stroke="#009b8b" strokeWidth="3" />
        <path
          d={path("predicted")}
          fill="none"
          stroke="#477798"
          strokeWidth="3"
          strokeDasharray="6 5"
        />
        {points.map((p, i) => (
          <g key={i}>
            {p.value != null && (
              <circle cx={x(i)} cy={y(p.value)} r="4" fill="#009b8b">
                <title>
                  {p.label}: {money(p.value, "USD")}
                </title>
              </circle>
            )}
            <rect
              x={x(i) - 10}
              y="20"
              width="20"
              height="175"
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {(points.length <= 7 || i % Math.ceil(points.length / 6) === 0) && (
              <text
                x={x(i)}
                y="210"
                textAnchor="middle"
                fontSize="10"
                fill="#658091"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover != null && (
        <p className="chart-tooltip">
          {points[hover].label} ·{" "}
          {money(points[hover].value ?? points[hover].predicted ?? 0, "USD")}
          {points[hover].value == null ? " projected" : ""}
        </p>
      )}
      <details className="fine-print">
        <summary>Accessible chart data</summary>
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Observed</th>
              <th>Projected</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td>{p.label}</td>
                <td>{p.value == null ? "—" : money(p.value, "USD")}</td>
                <td>{p.predicted == null ? "—" : money(p.predicted, "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
export function Trend({ rows, month }: { rows: Transaction[]; month: string }) {
  const [period, setPeriod] = useState("monthly"),
    [months, setMonths] = useState(6);
  const { category } = useWorkspace();
  const totals: Record<string, number> = {};
  const [year, number] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year || 2026, number || 10, 0)),
    days = end.getUTCDate();
  if (period === "monthly")
    for (let i = months - 1; i >= 0; i--) {
      const m = new Date(Date.UTC(year || 2026, (number || 10) - 1 - i, 1))
        .toISOString()
        .slice(0, 7);
      totals[m] = 0;
    }
  else if (period === "weekly")
    for (let i = 1; i <= Math.ceil(days / 7); i++)
      totals[`${month} · week ${i}`] = 0;
  else
    for (let i = 1; i <= days; i++)
      totals[`${month.slice(5)}-${String(i).padStart(2, "0")}`] = 0;
  const first = Object.keys(totals)[0];
  const selected = rows.filter(
    (r) =>
      (!category || r.category === category) &&
      (period === "monthly"
        ? r.occurred_at.slice(0, 7) >= first &&
          r.occurred_at.slice(0, 7) <= month
        : r.occurred_at.startsWith(month)),
  );
  selected.forEach((r) => {
    const date = r.occurred_at.slice(0, 10),
      key =
        period === "monthly"
          ? date.slice(0, 7)
          : period === "weekly"
            ? `${month} · week ${Math.ceil(Number(date.slice(8)) / 7)}`
            : date.slice(5);
    totals[key] = (totals[key] || 0) + r.amount_cents;
  });
  return (
    <>
      <div className="section-heading">
        <h2>Spending over time</h2>
        <div className="actions">
          {period === "monthly" && (
            <select
              aria-label="Trend range"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {[3, 6, 12].map((v) => (
                <option key={v} value={v}>
                  {v} months
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Trend interval"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {["daily", "weekly", "monthly"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="fine-print">
        {category || "All categories"} · through {month}. Days without imported
        purchases appear as zero.
      </p>
      <SeriesChart
        points={Object.entries(totals)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, value]) => ({ label, value }))}
      />
    </>
  );
}
