# FlowLedger API Contract

## Global Data Rules
* **Currency:** All money is tracked in integer cents (e.g., $50.00 is `5000`). Currency is explicit (e.g., `USD`).
* **Dates:** ISO 8601 format, timezone-aware.
* **Categories:** Must be exactly: Groceries, Dining, Transport, Housing, Shopping, Entertainment, Bills, Other.
* **Demo User:** `demo-user-001`
* **AI Security:** Gemini may propose edits, but explicit UI confirmation is required to save them.

## Official Endpoints
* `GET /health` - Server status
* `POST /transactions/import` - Upload the CSV
* `GET /transactions` - List all transactions
* `PATCH /transactions/{id}` - Edit a specific transaction
* `GET /dashboard/summary` - Get spending totals
* `POST /ml/forecast` - AI spending prediction
* `POST /agent/chat` - Talk to Gemini AI
* `POST /agent/confirm` - Approve AI action