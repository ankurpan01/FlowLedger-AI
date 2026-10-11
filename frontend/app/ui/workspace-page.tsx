"use client";
import Link from "next/link";
import { money } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import ChatWorkspace from "./chat-workspace";
import { Donut, Trend } from "./charts";
import TransactionsWorkspace from "./transactions-workspace";
import PlanningWorkspace from "./planning-workspace";
import DocumentsWorkspace from "./documents-workspace";
import PredictiveWorkspace from "./predictive-workspace";
import SettingsWorkspace from "./settings-workspace";
import PredictiveHighlight from "./predictive-highlight";
const titles = {
  dashboard: [
    "Your spending, clearly.",
    "An intelligent overview of your financial world.",
  ],
  assistant: [
    "Your AI workspace",
    "Conversations, grounded insights, and actions you control.",
  ],
  transactions: [
    "Transactions",
    "Find, categorize, and manage your saved records.",
  ],
  analytics: [
    "Spending analytics",
    "Understand the patterns behind your purchases.",
  ],
  predictions: [
    "AI Predictive Insights",
    "Estimate the rest of your month and understand what the numbers mean.",
  ],
  planning: [
    "Budgets & Financial Goals",
    "Give your spending a plan and your savings a purpose.",
  ],
  documents: [
    "Documents & Imports",
    "Turn statements into reviewed, structured financial data.",
  ],
  settings: [
    "Settings",
    "Manage your private workspace and financial preferences.",
  ],
};
export default function WorkspacePage({ view }: { view: keyof typeof titles }) {
  const store = useWorkspace(),
    stats = store.stats;
  const monthRows = store.rows.filter((r) =>
    r.occurred_at.startsWith(store.month),
  );
  const total = monthRows.reduce((s, r) => s + r.amount_cents, 0),
    budget = stats?.budgets.reduce((s, b) => s + b.amount_cents, 0) || 0;
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">FLOWLEDGER AI</p>
          <h1>{titles[view][0]}</h1>
          <p className="muted">{titles[view][1]}</p>
        </div>
        {["dashboard", "analytics", "transactions", "planning"].includes(
          view,
        ) && (
          <label className="month-picker">
            Reporting month
            <input
              type="month"
              value={store.month}
              onChange={(e) => {
                if (e.target.value) store.setMonth(e.target.value);
              }}
            />
          </label>
        )}
      </header>
      {view === "assistant" && <ChatWorkspace />}
      {view === "transactions" && <TransactionsWorkspace />}
      {view === "planning" && <PlanningWorkspace />}
      {view === "documents" && <DocumentsWorkspace />}
      {view === "predictions" && <PredictiveWorkspace />}
      {view === "settings" && <SettingsWorkspace />}
      {view === "dashboard" && (
        <>
          <ChatWorkspace compact />
          <PredictiveHighlight />
          <div className="metric-grid">
            <div className="metric highlight">
              <span>Net spending · {store.month || "—"}</span>
              <strong>{money(total, "USD")}</strong>
              <small>{monthRows.length} saved transactions</small>
            </div>
            <div className="metric">
              <span>Change from previous month</span>
              <strong>
                {stats?.change_cents == null
                  ? "—"
                  : `${stats.change_cents > 0 ? "+" : ""}${money(stats.change_cents, "USD")}`}
              </strong>
              <small>Observed monthly comparison</small>
            </div>
            <div className="metric">
              <span>Category budgets</span>
              <strong>{money(budget, "USD")}</strong>
              <small>
                {stats?.budgets.length || 0} monthly limits ·{" "}
                <Link href="/planning">Manage</Link>
              </small>
            </div>
          </div>
          <div className="two-columns">
            <section className="card">
              <div className="section-heading">
                <h2>Where your money goes</h2>
                <Link href="/analytics" className="text-link">
                  Explore ↗
                </Link>
              </div>
              <Donut rows={stats?.by_category || []} />
            </section>
            <section className="card">
              <Trend rows={store.rows} month={store.month} />
            </section>
          </div>
          <div className="two-columns">
            <section className="card">
              <h2>Financial signals</h2>
              {stats?.recommendations.map((r, i) => (
                <div key={i} className="warning">
                  {r.text}
                  <small>{r.source}</small>
                </div>
              ))}
              {!stats?.recommendations.length && (
                <p className="muted">
                  No recorded category budget overruns in this month. This
                  reflects imported purchases only.
                </p>
              )}
              <Link className="text-link" href="/predictions">
                Explore forecasted spending ↗
              </Link>
            </section>
            <section className="card">
              <h2>Goals in motion</h2>
              {stats?.goals.slice(0, 2).map((g) => (
                <div className="goal" key={g.id}>
                  <strong>{g.name}</strong>
                  <progress value={g.progress_cents} max={g.target_cents} />
                  <p className="muted">
                    {money(g.progress_cents, "USD")} /{" "}
                    {money(g.target_cents, "USD")}
                  </p>
                </div>
              ))}
              {!stats?.goals.length && (
                <p className="muted">
                  Create a savings goal or ask Gemini to prepare one.
                </p>
              )}
              <Link className="text-link" href="/planning">
                Plan your next goal ↗
              </Link>
            </section>
          </div>
          <TransactionsWorkspace recent />
        </>
      )}
      {view === "analytics" && (
        <>
          <div className="two-columns">
            <section className="card">
              <h2>Category distribution</h2>
              <Donut rows={stats?.by_category || []} />
              {store.category && (
                <button
                  className="secondary"
                  onClick={() => store.setCategory("")}
                >
                  Clear {store.category} filter
                </button>
              )}
            </section>
            <section className="card">
              <Trend rows={store.rows} month={store.month} />
            </section>
          </div>
          <section className="card">
            <h2>Budget versus actual</h2>
            {stats?.budgets.map((b) => {
              const spent =
                stats.by_category.find((r) => r.category === b.category)
                  ?.amount_cents || 0;
              return (
                <div className="budget-row" key={b.category}>
                  <strong>{b.category}</strong>
                  <progress
                    max={Math.max(1, b.amount_cents, spent)}
                    value={Math.max(0, spent)}
                  />
                  <span
                    className={spent > b.amount_cents ? "warning-text" : ""}
                  >
                    {money(spent, "USD")} / {money(b.amount_cents, "USD")}
                  </span>
                </div>
              );
            })}
          </section>
          <section className="card">
            <h2>Potential recurring expenses</h2>
            <p className="muted">
              Same merchant in at least three months with amounts within 15%. A
              heuristic, not a verified subscription.
            </p>
            {stats?.recurring.map((r) => (
              <div key={r.merchant} className="budget-row">
                <strong>{r.merchant}</strong>
                <span>Average {money(r.average_cents, "USD")}</span>
              </div>
            ))}
            {!stats?.recurring.length && (
              <p className="empty">
                No recurring pattern detected in this range.
              </p>
            )}
          </section>
          <TransactionsWorkspace recent />
        </>
      )}
    </div>
  );
}
