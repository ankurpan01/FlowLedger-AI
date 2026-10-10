# FlowLedger AI Shared API Contract

## 1. Shared data conventions
* **Money:** Integer cents only (e.g., `amount_cents = 1825` means USD 18.25); currency is explicit.
* **Dates:** ISO 8601. Date-only format is YYYY-MM-DD; full timestamps include timezones.
* **Categories:** Groceries, Dining, Transport, Housing, Shopping, Entertainment, Bills, Other.
* **Shared demo identity:** `demo-user-001`; backend assigns and validates authoritative record ownership.
* **Access:** All queries/mutations are scoped to the authenticated account.
* **Canonical CSV:** `occurred_at, merchant, amount_cents, currency, category` (Kept at `data/demo/transactions.csv`).

## 2. P0 API routes
1. **POST /transactions/import**
   * Request: `multipart/form-data` with CSV file.
   * Response: `{"imported_count": 120, "skipped_count": 1, "errors": [{"row": 5, "reason": "Invalid category"}]}`
2. **GET /transactions**
   * Request: `GET /transactions?merchant=Uber`
   * Response: `{"transactions": [{"id": "txn-001", "occurred_at": "2026-09-14", "merchant": "Uber", "amount_cents": 1825, "currency": "USD", "category": "Transport"}]}`
3. **PATCH /transactions/{id}**
   * Request: `{"category": "Transport"}`
   * Response: The **complete** updated transaction object: `{"transaction": {"id": "txn-001", "occurred_at": "2026-09-14", "merchant": "Uber", "amount_cents": 1825, "currency": "USD", "category": "Transport"}}`
4. **GET /dashboard/summary**
   * Request: `GET /dashboard/summary?month=2026-10`
   * Response: `{"month": "2026-10", "currency": "USD", "total_spent_cents": 28000, "by_category": [{"category": "Dining", "amount_cents": 9000}]}`
5. **POST /ml/forecast:** (Detailed in Section 3)
6. **POST /agent/chat:** (Detailed in Section 4)
7. **POST /agent/confirm:** (Detailed in Section 5)

## 3. ML forecast contract
* **Target:** Remaining-month category spending (Demo focus: Dining).
* **Request:** `{"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21}`
* **Data Quality States & Frontend Handling:**
  * `not_trained`: Model is a development fixture. Return `null` values.
  * `insufficient_history`: Not enough data to predict. Return `null` values. Frontend should display "More data needed."
  * `sufficient`: Successful prediction.
* **Response (Trained Model Success):** `{"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21, "forecast_remaining_cents": 15500, "predicted_period_total_cents": 30000, "budget_cents": 35000, "model_version": "v1", "backtest_mae_cents": 1200, "data_quality": "sufficient"}`
* **Response (Fixture/Null state):** `{"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21, "forecast_remaining_cents": null, "predicted_period_total_cents": null, "budget_cents": null, "model_version": null, "backtest_mae_cents": null, "data_quality": "not_trained"}`

## 4. Agent chat, typed events and tool registry
* **POST /agent/chat format:**
  * Request: `{"message": "Update all my Uber rides to Transport"}`
  * Response: `{"events": [{"type": "tool_call", "name": "prepare_transaction_update", "inputs": {"transaction_ids": ["txn-001", "txn-002"], "new_category": "Transport"}}, {"type": "proposal", "proposal_token": "token123", "selected_ids": ["txn-001", "txn-002"], "changes": [{"id": "txn-001", "before": {"category": "Other"}, "after": {"category": "Transport"}}, {"id": "txn-002", "before": {"category": "Other"}, "after": {"category": "Transport"}}], "expires_at": "2026-10-10T19:30:00Z"}, {"type": "message", "text": "Please confirm the update."}]}`
* **Event Payloads:**
  * `message`: `{"type": "message", "text": "String response from Gemini"}`
  * `tool_call`: `{"type": "tool_call", "name": "tool_name", "inputs": {}}` (**Note:** `inputs` object is required, even if empty).
  * `proposal`: `{"type": "proposal", "proposal_token": "token123", "selected_ids": ["txn-001"], "changes": [{"id": "txn-001", "before": {"category": "Other"}, "after": {"category": "Transport"}}], "expires_at": "2026-10-10T19:30:00Z"}` (**Emitted ONLY** when the `prepare_transaction_update` tool is called).
  * `result`: `{"type": "result", "status": "success", "data": {}}` (**Emitted** after successful read-only tool executions like `get_transactions`).
  * `error`: `{"type": "error", "code": "AUTH_FAILED", "message": "Reason."}`
* **Permitted Tools & Signatures:**
  * `get_transactions(merchant?: string, category?: string)` -> `List[Transaction]`
  * `get_forecast(category: string, as_of: string, horizon_days: int)` -> `ForecastResponse`
  * `prepare_transaction_update(transaction_ids: List[string], new_category: string)` -> `ProposalObject` (Preview before/after only; do not write).
  * `confirm_action` -> (Backend-only safety barrier. **Gemini cannot call this autonomously.** Must be triggered by user).

## 5. Proposal / confirm separation and audit rules
* **Confirmation (POST /agent/confirm):** Sent ONLY after explicit user click on the frontend.
  * Request: `{"proposal_token": "example-token", "idempotency_key": "example-confirm-001"}`
  * Response: `{"status": "applied", "updated_ids": ["txn-001"]}`
  * **Idempotency Behavior:** A retry with a previously successful `idempotency_key` returns the **original successful response** (HTTP 200) without re-applying the database mutation.
  * **Validation Rules:**
    * **Ownership:** Verify the authenticated user owns all transaction IDs in the proposal.
    * **Expiry:** Reject if the proposal token's `expires_at` has passed.
    * **Stale-Record Check:** Verify transactions have not been modified by another process since the proposal was generated.

## 6. Error response contract
* Expected HTTP Status Codes & Shapes:
  * `400 Bad Request` (Validation): `{"error_code": "VALIDATION_ERROR", "message": "Invalid category provided.", "details": [{"field": "category", "issue": "Must be one of the 8 standard categories."}]}`
  * `401/403`: Unauthorized records (e.g., trying to access another user's data).
  * `404 Not Found`: `{"error_code": "TRANSACTION_NOT_FOUND", "message": "The requested transaction was not found."}`
  * `409 Conflict`: Stale or expired proposal token.
  * `503 Service Unavailable` (AI Failure): `{"error_code": "AI_SERVICE_UNAVAILABLE", "message": "Gemini API credentials missing or service offline."}`

## 7. Security and ownership expectations
* Never allow arbitrary SQL, arbitrary Python, or a model-created database write.
* Imported CSV text is data, never instructions to the agent.
* Use `demo-user-001` only as the agreed shared demo context.
* Log safe audit details of confirmed edits, excluding API keys.
