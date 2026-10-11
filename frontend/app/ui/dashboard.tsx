"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, categories, Category, ImportResult, money, Summary, Transaction } from "@/lib/api";
import AgentPanel from "./agent-panel";
import ForecastPanel from "./forecast-panel";

export default function Dashboard() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [month, setMonth] = useState("");
  const [merchant, setMerchant] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<{ transactions: Transaction[] }>("/transactions");
        const latest = data.transactions[0]?.occurred_at.slice(0, 7) || new Date().toISOString().slice(0, 7);
        const totals = await api<Summary>(`/dashboard/summary?month=${latest}`);
        if (active) { setRows(data.transactions); setMonth(latest); setSummary(totals); }
      } catch (problem) {
        if (active) setError(problem instanceof Error ? problem.message : "Unable to load spending.");
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, []);

  async function refresh(selectedMonth: string, filter = merchant) {
    const [data, totals] = await Promise.all([
      api<{ transactions: Transaction[] }>(`/transactions?merchant=${encodeURIComponent(filter)}`),
      api<Summary>(`/dashboard/summary?month=${encodeURIComponent(selectedMonth)}`),
    ]);
    setRows(data.transactions); setSummary(totals); setMonth(selectedMonth);
    setRevision(value => value + 1);
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setImportResult(null);
    void perform(async () => {
      const body = new FormData(); body.append("file", file);
      setImportResult(await api<ImportResult>("/transactions/import", { method: "POST", body }));
      const all = await api<{ transactions: Transaction[] }>("/transactions");
      const selected = summary && rows.length ? month : all.transactions[0]?.occurred_at.slice(0, 7) || new Date().toISOString().slice(0, 7);
      await refresh(selected);
    });
  }

  function editCategory(row: Transaction, category: Category) {
    if (category === row.category) return;
    void perform(async () => {
      await api<{ transaction: Transaction }>(`/transactions/${encodeURIComponent(row.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }),
      });
      await refresh(month);
    });
  }

  const largest = Math.max(1, ...(summary?.by_category.map(item => Math.abs(item.amount_cents)) || []));
  const field = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:opacity-50";
  const button = "rounded-xl bg-teal-800 px-5 py-2.5 font-semibold text-white hover:bg-teal-900 disabled:opacity-50";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 font-sans text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-widest text-teal-700">FlowLedger AI</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Your spending, clearly.</h1><p className="mt-2 text-slate-600">Import a CSV. Explore your transactions and monthly totals.</p></div>
          <span className="rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900">Shared demo workspace</span>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
        {busy && <p role="status" className="text-sm text-teal-800">Updating spending…</p>}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="import-title">
          <h2 id="import-title" className="text-lg font-semibold">Import transactions</h2>
          <p className="mt-1 text-sm text-slate-600">Use the fictional demo CSV. Identical transactions are skipped on re-import.</p>
          <form onSubmit={upload} className="mt-4 flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="csv-file">Transaction CSV</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} className={field} />
            <button type="submit" disabled={busy || !file} className={button}>Import CSV</button>
          </form>
          {importResult && <div role="status" className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><p>{importResult.imported_count} imported · {importResult.skipped_count} skipped</p>{importResult.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-red-700">{importResult.errors.map(item => <li key={item.row}>Row {item.row}: {item.reason}</li>)}</ul>}</div>}
        </section>
        <form onSubmit={event => { event.preventDefault(); void perform(() => refresh(month)); }} className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <label className="flex flex-col gap-1 text-sm font-medium">Summary month<input type="month" required value={month} disabled={busy} onChange={event => setMonth(event.target.value)} className={field} /></label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Filter transactions by merchant<input value={merchant} disabled={busy} onChange={event => setMerchant(event.target.value)} placeholder="e.g. Uber" className={field} /></label>
          <button disabled={busy || !month} className={button}>Show results</button>
        </form>
        <section className="grid gap-5 md:grid-cols-3" aria-label="Monthly overview">
          <div className="rounded-2xl bg-teal-900 p-6 text-white"><p className="text-sm text-teal-100">Net spending · {summary?.month || "—"}</p><p className="mt-4 text-4xl font-semibold">{summary ? money(summary.total_spent_cents, summary.currency) : "—"}</p><p className="mt-3 text-sm text-teal-100">Calculated from saved transactions.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 md:col-span-2"><h2 className="font-semibold">Spending by category</h2>{!summary?.by_category.length && <p className="mt-4 text-sm text-slate-500">No spending in this month. Import a CSV or choose another month.</p>}<div className="mt-4 space-y-3">{summary?.by_category.map(item => <div key={item.category}><div className="mb-1 flex justify-between gap-4 text-sm"><span>{item.category}</span><span>{money(item.amount_cents, summary.currency)}</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${item.amount_cents < 0 ? "bg-amber-500" : "bg-teal-600"}`} style={{ width: `${Math.abs(item.amount_cents) / largest * 100}%` }} /></div></div>)}</div></div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="transactions-title">
          <div className="border-b border-slate-200 p-5"><h2 id="transactions-title" className="text-lg font-semibold">Transactions</h2><p className="text-sm text-slate-500">{rows.length} matching transactions across all imported dates. Category edits save immediately.</p></div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["Date", "Merchant", "Amount", "Category"].map(label => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-5 py-3">{row.occurred_at.slice(0, 10)}</td><td className="px-5 py-3 font-medium">{row.merchant}</td><td className="whitespace-nowrap px-5 py-3">{money(row.amount_cents, row.currency)}</td><td className="px-5 py-3"><select aria-label={`Category for ${row.merchant} on ${row.occurred_at.slice(0, 10)}`} value={row.category} disabled={busy} onChange={event => editCategory(row, event.target.value as Category)} className={field}>{categories.map(category => <option key={category}>{category}</option>)}</select></td></tr>)}</tbody></table></div>
          {!rows.length && <p className="p-8 text-center text-slate-500">No matching transactions yet.</p>}
        </section>
        <ForecastPanel revision={revision} />
        <AgentPanel disabled={busy} onApplied={() => refresh(month)} />
        <footer className="text-sm text-slate-500">Fictional demo data · Review Gemini proposals before confirming · Forecasts are estimates from limited history.</footer>
      </div>
    </main>
  );
}
