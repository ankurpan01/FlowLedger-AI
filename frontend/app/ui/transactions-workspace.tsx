"use client";
import Link from "next/link";
import { useState } from "react";
import { api, categories, Category, money, Transaction } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import Proposal, { ProposalData } from "./proposal";
export default function TransactionsWorkspace({
  recent = false,
}: {
  recent?: boolean;
}) {
  const store = useWorkspace(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState<Category>("Transport"),
    [proposal, setProposal] = useState<ProposalData | null>(null),
    [key, setKey] = useState(""),
    [date, setDate] = useState("2026-10-10"),
    [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [newCategory, setNewCategory] = useState<Category>("Other"),
    [showAdd, setShowAdd] = useState(false),
    [monthOnly, setMonthOnly] = useState(false);
  const rows = store.rows.filter(
    (r) =>
      (!store.category || r.category === store.category) &&
      r.merchant.toLowerCase().includes(store.merchant.toLowerCase()) &&
      (!monthOnly || r.occurred_at.startsWith(store.month)),
  );
  const visible = recent
    ? rows.slice(0, 5)
    : rows.slice(page * 20, page * 20 + 20);
  async function edit(row: Transaction, category: Category) {
    setBusy(true);
    setError("");
    try {
      await api(`/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      await store.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save category.");
    } finally {
      setBusy(false);
    }
  }
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
      setError(e instanceof Error ? e.message : "Could not prepare preview.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card transactions-card">
      <div className="section-heading">
        <div>
          <h2>{recent ? "Recent transactions" : "Your transactions"}</h2>
          <p className="muted">
            {recent
              ? "Latest saved purchases"
              : `${rows.length} matching records · manual category changes save immediately`}
          </p>
        </div>
        <Link
          href={recent ? "/transactions" : "/documents"}
          className="text-link"
        >
          {recent ? "View all ↗" : "Import statement ↗"}
        </Link>
      </div>
      {!recent && (
        <>
          <div className="filter-row">
            <label>
              Search merchant
              <input
                placeholder="e.g. Uber"
                value={store.merchant}
                onChange={(e) => {
                  store.setMerchant(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Category
              <select
                value={store.category}
                onChange={(e) => {
                  store.setCategory(e.target.value as Category | "");
                  setPage(0);
                }}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={monthOnly}
                onChange={(e) => {
                  setMonthOnly(e.target.checked);
                  setPage(0);
                }}
              />
              Only {store.month}
            </label>
            <button className="secondary" onClick={() => setShowAdd(!showAdd)}>
              + Add transaction
            </button>
          </div>
          {showAdd && (
            <form
              className="form-grid inset-panel"
              onSubmit={(e) => {
                e.preventDefault();
                void preview("/transactions/preview", {
                  action: "add",
                  record: {
                    occurred_at: date,
                    merchant: name,
                    amount_cents: Math.round(Number(amount) * 100),
                    currency: "USD",
                    category: newCategory,
                  },
                });
              }}
            >
              <div className="filter-row">
                <label>
                  Date
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  Merchant
                  <input
                    required
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Amount · USD
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Category
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as Category)}
                  >
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary" disabled={busy}>
                Review new transaction
              </button>
            </form>
          )}
          {selected.length > 0 && (
            <div className="actions inset-panel">
              <span>{selected.length} selected</span>
              <select
                aria-label="Bulk target category"
                value={target}
                onChange={(e) => setTarget(e.target.value as Category)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void preview("/transactions/category/preview", {
                    transaction_ids: selected,
                    new_category: target,
                  })
                }
              >
                Review category edits
              </button>
              <button
                className="secondary danger-text"
                disabled={busy}
                onClick={() =>
                  void preview("/transactions/preview", {
                    action: "delete",
                    transaction_ids: selected,
                  })
                }
              >
                Review deletion
              </button>
              <button className="text-link" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {!recent && <th>Select</th>}
              {["Date", "Merchant", "Amount", "Category"].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                {!recent && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.merchant} ${row.occurred_at.slice(0, 10)}`}
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                )}
                <td>{row.occurred_at.slice(0, 10)}</td>
                <td>
                  <strong>{row.merchant}</strong>
                </td>
                <td>{money(row.amount_cents, row.currency)}</td>
                <td>
                  {recent ? (
                    <span className="category-tag">{row.category}</span>
                  ) : (
                    <select
                      aria-label={`Category for ${row.merchant} on ${row.occurred_at.slice(0, 10)}`}
                      value={row.category}
                      disabled={busy}
                      onChange={(e) =>
                        void edit(row, e.target.value as Category)
                      }
                    >
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p className="empty">No transactions match these filters.</p>
      )}
      {!recent && rows.length > 20 && (
        <div className="pagination">
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(rows.length / 20)}
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 20 >= rows.length}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      )}
      {proposal && (
        <Proposal
          key={proposal.proposal_token}
          proposal={proposal}
          confirmationKey={key}
          onDone={() => {
            setSelected([]);
            setShowAdd(false);
          }}
        />
      )}
    </section>
  );
}
