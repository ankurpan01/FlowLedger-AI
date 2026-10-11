"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, categories } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import Proposal, { ProposalData } from "./proposal";
type RecordRow = {
  occurred_at: string;
  merchant: string;
  amount_cents: number;
  currency: string;
  category: string;
};
type Document = {
  id: string;
  filename: string;
  status: string;
  rows: RecordRow[];
  duplicates: boolean[];
  errors: { row: number; reason: string }[];
  text_preview: string;
};
type History = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
};
export default function DocumentsWorkspace() {
  const store = useWorkspace(),
    [file, setFile] = useState<File | null>(null),
    [doc, setDoc] = useState<Document | null>(null),
    [history, setHistory] = useState<History[]>([]),
    [proposal, setProposal] = useState<ProposalData | null>(null),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ documents: History[] }>("/documents");
    setHistory(r.documents);
  }, []);
  useEffect(() => {
    if (!store.workspace) return;
    let active = true;
    api<{ documents: History[] }>("/documents")
      .then((r) => {
        if (active) setHistory(r.documents);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [store.workspace, store.revision]);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const body = new FormData();
      body.append("file", file);
      setDoc(await api<Document>("/documents", { method: "POST", body }));
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not extract this statement.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      setProposal(
        await api<ProposalData>("/documents/import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: doc.id, rows: doc.rows }),
        }),
      );
      setKey(crypto.randomUUID());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Correct the extracted rows before importing.",
      );
    } finally {
      setBusy(false);
    }
  }
  function rowChange(i: number, k: keyof RecordRow, v: string) {
    if (!doc) return;
    setDoc({
      ...doc,
      rows: doc.rows.map((r, n) =>
        n === i
          ? {
              ...r,
              [k]: k === "amount_cents" ? Math.round(Number(v) * 100) : v,
            }
          : r,
      ),
    });
    setProposal(null);
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>Import a financial statement</h2>
        <p className="muted">
          CSV, XLSX, text PDF or TXT · maximum 2 MiB. Files are stored in your
          private workspace. Review before importing.
        </p>
        <div className="upload-box">
          <label>
            Financial file
            <input
              type="file"
              accept=".csv,.xlsx,.pdf,.txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={busy}
            />
          </label>
          <button
            className="primary"
            disabled={!file || busy || !store.workspace}
            onClick={() => void upload()}
          >
            {busy ? "Processing…" : "Extract & preview"}
          </button>
        </div>
        <details className="fine-print">
          <summary>Supported formats and limitations</summary>
          <p>
            CSV/XLSX columns: date (YYYY-MM-DD or MM/DD/YYYY),
            description/merchant, amount (USD dollars) or amount_cents; optional
            currency/category. XLSX uses the first sheet. Canonical CSV remains
            supported. Text PDF requires a recognizable table separated by
            pipes, tabs or multiple spaces. Unknown PDF layouts remain available
            as text for AI analysis; image-only PDFs require OCR and are
            rejected. Missing categories start as Other for review. Positive
            amounts represent spending; negatives represent refunds.
          </p>
          <a href="/sample-transactions.csv" download>
            Download a sample CSV
          </a>
        </details>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {doc && (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>{doc.filename}</h2>
              <p className="muted">
                {doc.rows.length} extracted records ·{" "}
                {doc.duplicates.filter(Boolean).length} possible duplicates ·{" "}
                {doc.status}
              </p>
            </div>
            <Link className="text-link" href="/assistant">
              Ask Gemini about this document ↗
            </Link>
          </div>
          {doc.errors.map((e, i) => (
            <p className="warning" key={i}>
              Row {e.row}: {e.reason}
            </p>
          ))}
          {doc.rows.length > 0 && (
            <div className="table-scroll preview-table">
              <table>
                <thead>
                  <tr>
                    {[
                      "Date",
                      "Merchant",
                      "Amount · USD",
                      "Category",
                      "Review",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Date for row ${i + 1}`}
                          type="date"
                          value={r.occurred_at.slice(0, 10)}
                          disabled={doc.status === "imported"}
                          onChange={(e) =>
                            rowChange(i, "occurred_at", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Merchant for row ${i + 1}`}
                          value={r.merchant}
                          maxLength={200}
                          disabled={doc.status === "imported"}
                          onChange={(e) =>
                            rowChange(i, "merchant", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Amount for row ${i + 1}`}
                          type="number"
                          step="0.01"
                          value={r.amount_cents / 100}
                          disabled={doc.status === "imported"}
                          onChange={(e) =>
                            rowChange(i, "amount_cents", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Category for row ${i + 1}`}
                          value={r.category}
                          disabled={doc.status === "imported"}
                          onChange={(e) =>
                            rowChange(i, "category", e.target.value)
                          }
                        >
                          {categories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {doc.duplicates[i] ? "Possible duplicate" : ""}
                        {doc.status !== "imported" && (
                          <button
                            className="text-link"
                            onClick={() => {
                              setDoc({
                                ...doc,
                                rows: doc.rows.filter((_, n) => n !== i),
                                duplicates: doc.duplicates.filter(
                                  (_, n) => n !== i,
                                ),
                              });
                              setProposal(null);
                            }}
                          >
                            Exclude row
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="tool-activity">
            <summary>Extracted text preview</summary>
            <pre>{doc.text_preview}</pre>
          </details>
          {doc.status !== "imported" && doc.rows.length > 0 && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void preview()}
            >
              Review import of {doc.rows.length} records
            </button>
          )}
        </section>
      )}
      {proposal && (
        <Proposal
          key={proposal.proposal_token}
          proposal={proposal}
          confirmationKey={key}
          onDone={() => {
            if (doc) setDoc({ ...doc, status: "imported" });
            void load();
          }}
        />
      )}
      <section className="card">
        <h2>Document history</h2>
        <div className="document-list">
          {history.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                setProposal(null);
                void api<Document>(`/documents/${h.id}`)
                  .then(setDoc)
                  .catch((e) => setError(e.message));
              }}
            >
              <span>
                ▤ <strong>{h.filename}</strong>
                <small>
                  {h.created_at.slice(0, 10)} · {h.row_count} records
                </small>
              </span>
              <span className="badge">{h.status}</span>
            </button>
          ))}
        </div>
        {!history.length && (
          <p className="empty">
            Uploaded files and import results will be saved here.
          </p>
        )}
      </section>
    </div>
  );
}
