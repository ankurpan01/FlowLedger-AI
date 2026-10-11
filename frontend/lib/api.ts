export const categories = ["Groceries", "Dining", "Transport", "Housing", "Shopping", "Entertainment", "Bills", "Other"] as const;
export type Category = (typeof categories)[number];
export type Transaction = { id: string; occurred_at: string; merchant: string; amount_cents: number; currency: string; category: Category };
export type Summary = { month: string; currency: string; total_spent_cents: number; by_category: { category: Category; amount_cents: number }[] };
export type ImportResult = { imported_count: number; skipped_count: number; errors: { row: number; reason: string }[] };
export type Forecast = {
  category: Category; as_of: string; horizon_days: number;
  forecast_remaining_cents: number | null; predicted_period_total_cents: number | null;
  budget_cents: number | null; model_version: string | null; backtest_mae_cents: number | null;
  data_quality: "not_trained" | "insufficient_history" | "sufficient";
};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new Error("The data service is not configured.");
  let response: Response;
  try {
    const headers = new Headers(options?.headers);
    const key = typeof window === 'undefined' ? null : localStorage.getItem('flowledger-workspace-key');
    if (key) headers.set('Authorization', `Bearer ${key}`);
    response = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...options, headers, cache: "no-store" });
  } catch { throw new Error("The data service is unavailable. Please try again."); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "The request could not be completed.");
  return body as T;
}

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
