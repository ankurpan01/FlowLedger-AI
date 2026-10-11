"use client";
import { useState } from "react";
import { api, categories } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
export default function SettingsWorkspace() {
  const store = useWorkspace(),
    [name, setName] = useState(""),
    [remember, setRemember] = useState<boolean | null>(null),
    [recovery, setRecovery] = useState(""),
    [show, setShow] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/workspaces/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || store.workspace?.name || "My workspace",
          remember_context:
            remember ?? store.workspace?.preferences.remember_context ?? true,
        }),
      });
      store.reconnect();
      setNotice("Preferences saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setBusy(true);
    setError("");
    const old = localStorage.getItem("flowledger-workspace-key");
    try {
      localStorage.setItem("flowledger-workspace-key", recovery.trim());
      await api("/workspaces/me");
      localStorage.removeItem("flowledger-current-chat");
      window.location.reload();
    } catch {
      if (old) localStorage.setItem("flowledger-workspace-key", old);
      else localStorage.removeItem("flowledger-workspace-key");
      setError("That recovery key could not open a workspace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <section className="card narrow">
        <h2>Workspace preferences</h2>
        <div className="form-grid">
          <label>
            Workspace name
            <input
              maxLength={80}
              value={name || store.workspace?.name || ""}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={
                remember ??
                store.workspace?.preferences.remember_context ??
                true
              }
              onChange={(e) => setRemember(e.target.checked)}
            />
            Use the last five turns as conversational context
          </label>
          <p className="fine-print">
            Turning context off preserves saved history, but each new Gemini
            request starts without previous turns.
          </p>
          <button
            className="primary"
            disabled={busy || !store.workspace}
            onClick={() => void save()}
          >
            Save preferences
          </button>
          {notice && (
            <p role="status" className="success">
              {notice}
            </p>
          )}
        </div>
      </section>
      <section className="card narrow">
        <h2>Access and recovery</h2>
        <p className="muted">
          Your workspace has a private recovery key stored in this browser. Save
          it securely to reopen the same data in another browser. Anyone with
          the key can access the workspace. This prototype does not provide
          email login, verified identity, or bank connections.
        </p>
        <button className="secondary" onClick={() => setShow(!show)}>
          {show ? "Hide recovery key" : "Show my recovery key"}
        </button>
        {show && (
          <textarea
            readOnly
            aria-label="Workspace recovery key"
            value={
              typeof window === "undefined"
                ? ""
                : localStorage.getItem("flowledger-workspace-key") || ""
            }
          />
        )}
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void recover();
          }}
        >
          <label>
            Open an existing workspace
            <input
              type="password"
              required
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              placeholder="Paste your saved recovery key"
            />
          </label>
          <button className="secondary" disabled={busy}>
            Open workspace
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="card narrow">
        <h2>Financial conventions</h2>
        <p>
          Currency: USD. Dates: UTC. Money is saved as integer cents. Positive
          amounts represent spending and negative amounts represent refunds.
        </p>
        <p className="muted">
          Categories: {categories.join(", ")}. Categories are fixed to preserve
          the shared API contract.
        </p>
        <p className="warning">
          Use fictional data for this public hackathon prototype. Workspace keys
          provide separation, but this is not a production financial account
          service.
        </p>
      </section>
    </div>
  );
}
