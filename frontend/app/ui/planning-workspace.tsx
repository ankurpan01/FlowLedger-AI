"use client";
import { FormEvent, useState } from "react";
import { api, categories, Category, money } from "@/lib/api";
import { Goal, useWorkspace } from "./workspace-provider";
import Proposal, { ProposalData } from "./proposal";
export default function PlanningWorkspace() {
  const [now] = useState(() => Date.now());
  const store = useWorkspace(),
    [category, setCategory] = useState<Category>("Groceries"),
    [amount, setAmount] = useState("300"),
    [goal, setGoal] = useState<Goal | null>(null),
    [name, setName] = useState(""),
    [target, setTarget] = useState("2000"),
    [progress, setProgress] = useState("0"),
    [deadline, setDeadline] = useState(""),
    [kind, setKind] = useState("savings"),
    [proposal, setProposal] = useState<ProposalData | null>(null),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function preview(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      setProposal(
        await api<ProposalData>(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setKey(crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare changes.");
    } finally {
      setBusy(false);
    }
  }
  function edit(g: Goal) {
    setGoal(g);
    setName(g.name);
    setTarget(String(g.target_cents / 100));
    setProgress(String(g.progress_cents / 100));
    setDeadline(g.deadline || "");
    setKind(g.kind);
  }
  return (
    <div className="stack">
      <div className="two-columns">
        <section className="card">
          <h2>Monthly category budgets</h2>
          <p className="muted">
            Recurring monthly limits, persisted in your workspace.
          </p>
          <form
            className="form-grid"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void preview("/planning/budget/preview", {
                category,
                amount_cents: Math.round(Number(amount) * 100),
              });
            }}
          >
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
              Monthly budget · USD
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !store.workspace}>
              Review budget change
            </button>
          </form>
          <div className="budget-list">
            {store.stats?.budgets.map((b) => {
              const spent =
                store.stats?.by_category.find((c) => c.category === b.category)
                  ?.amount_cents || 0;
              return (
                <div key={b.category}>
                  <div className="section-heading">
                    <strong>{b.category}</strong>
                    <span>
                      {money(spent, "USD")} / {money(b.amount_cents, "USD")}
                    </span>
                  </div>
                  <progress
                    max={Math.max(1, b.amount_cents)}
                    value={Math.max(0, spent)}
                  />
                  <p
                    className={
                      spent > b.amount_cents ? "warning-text" : "muted"
                    }
                  >
                    {money(Math.abs(b.amount_cents - spent), "USD")}{" "}
                    {spent > b.amount_cents ? "over budget" : "remaining"} ·{" "}
                    {store.month}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <h2>{goal ? "Update financial goal" : "Create a financial goal"}</h2>
          <p className="muted">
            Progress is recorded by you; it is not a bank balance.
          </p>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void preview("/planning/goal/preview", {
                id: goal?.id,
                name,
                target_cents: Math.round(Number(target) * 100),
                progress_cents: Math.round(Number(progress) * 100),
                deadline: deadline || null,
                kind,
              });
            }}
          >
            <label>
              Name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Emergency fund"
              />
            </label>
            <label>
              Goal type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="savings">Savings</option>
                <option value="spending_reduction">Spending reduction</option>
              </select>
            </label>
            <div className="two-columns">
              <label>
                Target · USD
                <input
                  required
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              <label>
                Recorded progress · USD
                <input
                  required
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value)}
                />
              </label>
            </div>
            <label>
              Deadline · optional
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy || !store.workspace}>
                Review goal
              </button>
              {goal && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setGoal(null);
                    setName("");
                    setProgress("0");
                  }}
                >
                  New goal
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {proposal && (
        <Proposal
          key={proposal.proposal_token}
          proposal={proposal}
          confirmationKey={key}
        />
      )}
      <section className="card">
        <h2>Your goals</h2>
        <div className="goal-grid">
          {store.stats?.goals.map((g) => (
            <article key={g.id} className="goal">
              <div className="section-heading">
                <h3>{g.name}</h3>
                <button className="text-link" onClick={() => edit(g)}>
                  Edit
                </button>
              </div>
              <p>
                {money(g.progress_cents, "USD")} of{" "}
                {money(g.target_cents, "USD")}
              </p>
              <progress value={g.progress_cents} max={g.target_cents} />
              <p className="muted">
                {((g.progress_cents / g.target_cents) * 100).toFixed(0)}% ·{" "}
                {g.deadline ? `Due ${g.deadline}` : "No deadline"} ·{" "}
                {g.kind.replaceAll("_", " ")}
              </p>
              {g.deadline &&
                new Date(g.deadline + "T00:00:00Z") > new Date(now) &&
                g.progress_cents < g.target_cents && (
                  <p className="fine-print">
                    Planning heuristic: about{" "}
                    {money(
                      Math.ceil(
                        ((g.target_cents - g.progress_cents) /
                          Math.max(
                            1,
                            (new Date(g.deadline + "T00:00:00Z").getTime() -
                              now) /
                              86400000,
                          )) *
                          30,
                      ),
                      "USD",
                    )}{" "}
                    per 30 days to reach the target. This is not a forecast of
                    your income.
                  </p>
                )}
            </article>
          ))}
        </div>
        {!store.stats?.goals.length && (
          <p className="empty">
            Create your first goal, or ask Gemini to prepare one.
          </p>
        )}
      </section>
    </div>
  );
}
