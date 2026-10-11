"use client";

import { FormEvent, useState } from "react";
import { api, Category, Forecast, Transaction } from "@/lib/api";
import { ForecastResult } from "./forecast-panel";

type Proposal = {
  type: "proposal"; proposal_token: string; selected_ids: string[];
  changes: { id: string; before: { category: Category }; after: { category: Category } }[];
  expires_at: string;
};
type AgentEvent = Proposal | { type: "message"; text: string } |
  { type: "tool_call"; name: string; inputs: Record<string, unknown> } |
  { type: "result"; status: string; data: { transactions?: Transaction[]; forecast?: Forecast } } |
  { type: "error"; code: string; message: string };

export default function AgentPanel({ onApplied, disabled }: { onApplied: () => Promise<void>; disabled: boolean }) {
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmStarted, setConfirmStarted] = useState(false);
  const [applied, setApplied] = useState(false);
  const blocked = busy || disabled;

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice(""); setProposal(null); setEvents([]); setApplied(false); setConfirmStarted(false);
    try {
      const response = await api<{ events: AgentEvent[] }>("/agent/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }),
      });
      setEvents(response.events);
      const prepared = response.events.find((item): item is Proposal => item.type === "proposal");
      if (prepared) { setProposal(prepared); setKey(crypto.randomUUID()); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to prepare a proposal."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || applied) return;
    setBusy(true); setError(""); setConfirmStarted(true);
    try {
      const result = await api<{ status: "applied"; updated_ids: string[] }>("/agent/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_token: proposal.proposal_token, idempotency_key: key }),
      });
      // Keep the same key for an uncertain network retry. Never generate it on click.
      setApplied(true); setNotice(`${result.updated_ids.length} transactions saved.`);
      try { await onApplied(); }
      catch { setError("Changes were saved, but the dashboard could not refresh. Reload the page."); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Confirmation failed. Retry uses the same confirmation key."); }
    finally { setBusy(false); }
  }

  const observed = events.flatMap(item => item.type === "result" ? item.data.transactions || [] : []);
  const button = "rounded-xl bg-teal-800 px-5 py-2.5 font-semibold text-white hover:bg-teal-900 disabled:opacity-50";
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="agent-title">
      <h2 id="agent-title" className="text-lg font-semibold">Ask FlowLedger</h2>
      <p className="mt-1 text-sm text-slate-600">Ask about transactions or request category changes. Review each proposed change before saving.</p>
      <form onSubmit={ask} className="mt-4 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="agent-message">Your request</label>
        <input id="agent-message" required maxLength={2000} value={message} disabled={blocked} onChange={event => setMessage(event.target.value)} placeholder="Move all my Uber rides to Other" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 disabled:opacity-50" />
        <button disabled={blocked || !message.trim()} className={button}>Ask Gemini</button>
      </form>
      {busy && <p role="status" className="mt-3 text-sm text-teal-800">{confirmStarted ? "Saving confirmed changes…" : "Preparing a response…"}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl bg-teal-50 p-3 text-teal-900">{notice}</p>}
      <div className="mt-3 space-y-2 text-sm">{events.map((item, index) => item.type === "message" ? <p key={index} className="whitespace-pre-wrap">{item.text}</p> : item.type === "error" ? <p key={index} role="alert" className="text-red-800">{item.message}</p> : null)}</div>
      {events.map((item, index) => item.type === "result" && item.data.forecast ? <ForecastResult key={index} forecast={item.data.forecast} /> : null)}
      {proposal && <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
        <h3 className="font-semibold">{applied ? "Confirmed changes" : "Review proposed changes"}</h3>
        {!applied && <p className="mt-1 text-sm">Nothing has been edited yet. Preview expires {new Date(proposal.expires_at).toLocaleTimeString()}.</p>}
        <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Transaction", "Before", "After"].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{proposal.changes.map(change => {
          const row = observed.find(item => item.id === change.id);
          return <tr key={change.id} className="border-t border-teal-200"><td className="p-2">{row ? `${row.merchant} · ${row.occurred_at.slice(0, 10)}` : change.id}<span className="block text-xs text-slate-500">{change.id}</span></td><td className="p-2">{change.before.category}</td><td className="p-2">{change.after.category}{change.before.category === change.after.category && <span className="block text-xs text-slate-500">Already this category</span>}</td></tr>;
        })}</tbody></table></div>
        {!applied && <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={blocked} onClick={() => void confirm()} className={button}>{confirmStarted ? "Retry confirmation" : "Confirm changes"}</button><button type="button" disabled={blocked || confirmStarted} onClick={() => { setProposal(null); setEvents([]); setNotice("Preview dismissed. No changes were applied."); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2">Cancel</button></div>}
      </div>}
    </section>
  );
}
