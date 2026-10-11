"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, Transaction, Category } from "@/lib/api";

export type Budget = {
  id: string | null;
  category: Category;
  amount_cents: number;
};
export type Goal = {
  id: string;
  name: string;
  kind: string;
  target_cents: number;
  progress_cents: number;
  deadline: string | null;
};
export type Stats = {
  month: string;
  total_spent_cents: number;
  change_cents: number | null;
  by_category: { category: Category; amount_cents: number }[];
  monthly: { month: string; amount_cents: number }[];
  daily: { date: string; amount_cents: number }[];
  recurring: { merchant: string; average_cents: number; source: string }[];
  alerts: { category: Category; over_cents: number }[];
  recommendations: { text: string; source: string }[];
  budgets: Budget[];
  goals: Goal[];
};
type Workspace = {
  id: string;
  name: string;
  preferences: { remember_context: boolean; currency: string };
};
type Store = {
  rows: Transaction[];
  stats: Stats | null;
  month: string;
  setMonth: (m: string) => void;
  category: Category | "";
  setCategory: (c: Category | "") => void;
  merchant: string;
  setMerchant: (m: string) => void;
  refresh: () => Promise<void>;
  busy: boolean;
  error: string;
  workspace: Workspace | null;
  revision: number;
  reconnect: () => void;
};
const Context = createContext<Store | null>(null);
let creation: Promise<void> | null = null;
async function ensureWorkspace() {
  if (localStorage.getItem("flowledger-workspace-key")) return;
  if (!creation)
    creation = api<{ workspace_key: string }>("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My FlowLedger", seed_demo: true }),
    })
      .then((created) => {
        localStorage.setItem("flowledger-workspace-key", created.workspace_key);
      })
      .finally(() => {
        creation = null;
      });
  await creation;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider is missing");
  return value;
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<Transaction[]>([]),
    [stats, setStats] = useState<Stats | null>(null),
    [month, setMonth] = useState(""),
    [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [category, setCategory] = useState<Category | "">(""),
    [merchant, setMerchant] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [attempt, setAttempt] = useState(0);
  const selected = useRef(""),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ transactions: Transaction[] }>("/transactions");
      const m =
        selected.current ||
        data.transactions[0]?.occurred_at.slice(0, 7) ||
        "2026-10";
      const report = await api<Stats>(`/analytics?month=${m}&months=6`);
      if (run === sequence.current) {
        setRows(data.transactions);
        setStats(report);
        setMonth(m);
        selected.current = m;
        setRevision((v) => v + 1);
      }
    } catch (e) {
      if (run === sequence.current)
        setError(
          e instanceof Error ? e.message : "Could not load your workspace.",
        );
      throw e;
    } finally {
      if (run === sequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        await ensureWorkspace();
        const me = await api<Workspace>("/workspaces/me");
        if (active) {
          setWorkspace(me);
          await refresh();
        }
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error ? e.message : "Unable to open workspace.",
          );
          setBusy(false);
        }
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, [attempt, refresh]);
  useEffect(() => {
    function sync() {
      if (document.visibilityState === "visible" && workspace)
        void refresh().catch(() => {});
    }
    function storage(e: StorageEvent) {
      if (e.key === "flowledger-data-version" && workspace)
        void refresh().catch(() => {});
    }
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("storage", storage);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("storage", storage);
    };
  }, [workspace, refresh]);
  const reload = useCallback(async () => {
    await refresh();
    localStorage.setItem("flowledger-data-version", String(Date.now()));
  }, [refresh]);
  return (
    <Context.Provider
      value={{
        rows,
        stats,
        month,
        setMonth: (m) => {
          selected.current = m;
          setMonth(m);
          void refresh().catch(() => {});
        },
        category,
        setCategory,
        merchant,
        setMerchant,
        refresh: reload,
        busy,
        error,
        workspace,
        revision,
        reconnect: () => setAttempt((v) => v + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
