# FlowLedger AI Shared API Contract

## 1. Shared data conventions
* **Money:** Integer cents only (e.g., `amount_cents = 1825` means USD 18.25); currency is explicit[cite: 6].
* **Dates:** ISO 8601. Date-only format is YYYY-MM-DD; full timestamps include timezones[cite: 6].
* **Categories:** Groceries, Dining, Transport, Housing, Shopping, Entertainment, Bills, Other[cite: 6].
* **Shared demo identity:** `demo-user-001`; backend assigns and validates authoritative record ownership[cite: 6].
* **Access:** All queries/mutations are scoped to the authenticated account, not a client-supplied owner ID[cite: 6].
* **Canonical CSV:** `occurred_at, merchant, amount_cents, currency, category` (Fictional transactions only, kept at `data/demo/transactions.csv` during Step 11)[cite: 6].

## 2. P0 API routes
1. **POST /transactions/import:** Upload fictional CSV and validate records[cite: 7].
   * Request: `multipart/form-data` with CSV file[cite: 7].
   * Response: `{"imported_count": 120, "skipped_count": 0, "errors": []}`[cite: 7].
2. **GET /transactions:** Fetch account-scoped purchases[cite: 7].
   * Request: `GET /transactions?merchant=Uber`[cite: 7].
   * Response: `{"transactions": [{"id": "txn-001", "occurred_at": "2026-09-14", "merchant": "Uber", "amount_cents": 1825, "currency": "USD", "category": "Transport"}]}`[cite: 7].
3. **PATCH /transactions/{id}:** Manual authorized transaction edit[cite: 7].
   * Request: `{"category": "Transport"}`[cite: 7].
   * Response: `{"transaction": {"id": "txn-001", "category": "Transport", "amount_cents": 1825, "currency": "USD"}}`[cite: 7].
4. **GET /dashboard/summary:** Actual financial totals and trends[cite: 7].
   * Request: `GET /dashboard/summary?month=2026-10`[cite: 8].
   * Response: `{"month": "2026-10", "currency": "USD", "total_spent_cents": 28000, "by_category": [{"category": "Dining", "amount_cents": 9000}]}`[cite: 8].
5. **POST /ml/forecast:** Predicted category spend (Detailed in Section 3)[cite: 7].
6. **POST /agent/chat:** Jay calls Ankur Gemini agent and receives typed events[cite: 7].
7. **POST /agent/confirm:** Jay triggers explicit confirmation of an existing proposal[cite: 7].

## 3. ML forecast contract
* Target: Remaining-month category spending (Demo focus: Dining)[cite: 8].
* Request: `{"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21}`[cite: 8].
* Response (Pre-training fixtures): `{"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21, "forecast_remaining_cents": null, "predicted_period_total_cents": null, "budget_cents": null, "model_version": null, "backtest_mae_cents": null, "data_quality": "not_trained"}`[cite: 8].
* Sparse history policy: Will return an explicit `INSUFFICIENT_HISTORY` error or data-quality state, never an invented prediction[cite: 8].

## 4. Agent chat, typed events and tool registry
* **Typed Events:** Must be exactly `message`, `tool_call`, `proposal`, `result`, `error`[cite: 9].
* **Permitted Tools:**
  * `get_transactions` (READ): Retrieve authorized matching transaction IDs and fields[cite: 8].
  * `get_forecast` (READ): Return Ankur trained forecast via safe adapter[cite: 8].
  * `prepare_transaction_update` (PROPOSE): Preview before/after only; do not write[cite: 8].
  * `confirm_action` (COMMIT): Handler invoked ONLY by an explicit user-driven confirmation event[cite: 8].
* **Boundary Restriction:** The model must never autonomously invoke the final commit[cite: 9].

## 5. Proposal / confirm separation and audit rules
* **Proposal Object:** Carries affected IDs, exact before/after values, expiry, and a proposal token[cite: 9].
  * Example: `{"type": "proposal", "proposal_token": "example-token", "selected_ids": ["txn-001"], "changes": [{"id": "txn-001", "before": {"category": "Other"}, "after": {"category": "Transport"}}], "expires_at": "2026-10-10T19:30:00Z"}`[cite: 9].
* **Confirmation (POST /agent/confirm):** Sent only after explicit user click[cite: 9].
  * Request: `{"proposal_token": "example-token", "idempotency_key": "example-confirm-001"}`[cite: 9].
  * Response: `{"status": "applied", "updated_ids": ["txn-001"]}`[cite: 9].
* **Validation:** Backend must validate ownership, proposal version/freshness, expiry, and idempotency[cite: 9].

## 6. Error response contract
* Shape: `{"error_code": "TRANSACTION_NOT_FOUND", "message": "The requested transaction was not found."}`[cite: 9].
* Includes states for unauthorized records, missing transactions, stale/expired proposals, duplicate confirmations, invalid categories/CSVs, missing AI credentials, and insufficient history[cite: 10].
* Error text must not expose secrets or another user's records[cite: 10].

## 7. Security and ownership expectations
* Never allow arbitrary SQL, arbitrary Python, or a model-created database write[cite: 10].
* Imported CSV text is data, never instructions to the agent[cite: 10].
* Use `demo-user-001` only as the agreed shared demo context; never trust arbitrary owner IDs supplied by users[cite: 10].
* Log safe audit details of confirmed edits, excluding API keys and other sensitive secrets[cite: 10].

## 8. Open questions / sign-off
* Pending three-person team approval in Step 10[cite: 12].