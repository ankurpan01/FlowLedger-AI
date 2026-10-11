"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";
const pages = [
  ["/", "Dashboard", "◈"],
  ["/assistant", "AI Assistant", "✧"],
  ["/transactions", "Transactions", "↔"],
  ["/analytics", "Analytics", "▥"],
  ["/predictions", "Predictive Insights", "⌁"],
  ["/planning", "Budgets & Goals", "◎"],
  ["/documents", "Documents & Imports", "▤"],
  ["/settings", "Settings", "⚙"],
];
function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    [open, setOpen] = useState(false),
    store = useWorkspace();
  return (
    <div className="app-shell">
      <aside className={open ? "sidebar is-open" : "sidebar"}>
        <Link href="/" className="brand">
          FLOWLEDGER <span>AI</span>
        </Link>
        <p className="sidebar-caption">Your spending, clearly.</p>
        <nav aria-label="Main navigation">
          {pages.map(([url, name, icon]) => (
            <Link
              key={url}
              href={url}
              aria-current={path === url ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={path === url ? "nav-link active" : "nav-link"}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="online-dot" />
          Private demo workspace<p>Fictional data. Real AI tools.</p>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <button
            className="mobile-menu secondary"
            aria-expanded={open}
            aria-label="Toggle navigation"
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <span>{store.workspace?.name || "Opening workspace…"}</span>
          <Link href="/assistant" className="assistant-link">
            ✧ Ask Gemini
          </Link>
        </header>
        <main className="page-content">
          {store.error && (
            <div role="alert" className="error">
              {store.error}
              <button
                className="secondary"
                onClick={() =>
                  store.workspace
                    ? void store.refresh().catch(() => {})
                    : store.reconnect()
                }
              >
                Retry connection
              </button>
              <Link href="/settings">Workspace settings</Link>
            </div>
          )}
          {store.busy && (
            <p role="status" className="loading">
              Synchronizing your workspace…
            </p>
          )}
          {children}
        </main>
        <footer className="app-footer">
          Fictional demo data · Changes require review · Forecasts are estimates
          from limited history.
        </footer>
      </div>
    </div>
  );
}
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
