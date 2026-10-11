"use client";
import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
export type ProposalData = {
  type: "proposal";
  kind?: string;
  proposal_token: string;
  selected_ids: string[];
  changes: {
    id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }[];
  expires_at: string;
};
function describe(value: Record<string, unknown> | null) {
  if (!value) return "New record";
  return Object.entries(value)
    .filter(([k]) => !["id", "updated_at", "duplicate"].includes(k))
    .map(
      ([k, v]) =>
        `${k.replaceAll("_", " ")}: ${k.endsWith("_cents") && typeof v === "number" ? money(v, "USD") : String(v ?? "—")}`,
    )
    .join(" · ");
}
export default function Proposal({
  proposal,
  confirmationKey,
  onDone,
}: {
  proposal: ProposalData;
  confirmationKey: string;
  onDone?: () => void;
}) {
  const store = useWorkspace(),
    [status, setStatus] = useState("pending"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ status: string }>("/proposals/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_token: proposal.proposal_token }),
    })
      .then((r) => {
        if (active) setStatus(r.status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [proposal.proposal_token]);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await api("/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_token: proposal.proposal_token,
          idempotency_key: confirmationKey,
        }),
      });
      setStatus("applied");
      await store.refresh();
      onDone?.();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Retry uses the same confirmation key.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await api("/proposals/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_token: proposal.proposal_token }),
      });
      setStatus("dismissed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss preview.");
    } finally {
      setBusy(false);
    }
  }
  if (status === "dismissed")
    return <p className="muted">Preview dismissed. Nothing was saved.</p>;
  return (
    <section className="proposal" aria-label="Review proposed changes">
      <div className="section-heading">
        <h3>
          {status === "applied"
            ? "Confirmed changes"
            : "Review proposed changes"}
        </h3>
        <span className="badge">{proposal.kind || "Transactions"}</span>
      </div>
      <p className="muted">
        {status === "applied"
          ? "Saved to your workspace."
          : status === "expired"
            ? "This preview expired. Ask for a new one."
            : `Nothing saved yet. Expires ${new Date(proposal.expires_at).toLocaleTimeString()}.`}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {proposal.changes.slice(0, 100).map((c, i) => (
              <tr key={c.id}>
                <td>
                  {proposal.kind === "document"
                    ? `Row ${i + 1}`
                    : c.id.slice(0, 8)}
                </td>
                <td>{describe(c.before)}</td>
                <td>
                  {describe(c.after)}
                  {c.after.duplicate === true && (
                    <span className="badge">Duplicate · will skip</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.changes.length > 100 && (
        <p>
          {proposal.changes.length} records total; first 100 shown. Review all
          records in the document preview before confirming.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status === "pending" && (
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy
              ? "Saving…"
              : error
                ? "Retry confirmation"
                : "Confirm changes"}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
