# FlowLedger AI

FlowLedger AI is a team project for exploring AI-assisted financial insights.

## Prerequisites

- Python 3.12 or 3.13
- Node.js 22 LTS and npm (GoDaddy's reported runtime is Node.js 22)

## 1. Start the backend

From the repository root, install the backend dependencies and start the API:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

The API should be available at http://localhost:8000.
Check its health endpoint at http://localhost:8000/health.
Interactive API documentation is available at http://localhost:8000/docs.

Before starting, copy `backend/.env.example` to `backend/.env` and configure
`DATABASE_URL` privately. Set `GEMINI_API_KEY` only for the existing chat prototype.
Never commit real API keys or other private values. Process environment variables
take precedence over the file. The backend locates this file independently of
the shell's working directory.

On Windows PowerShell, use `python -m venv .venv`, then
`.venv\Scripts\python.exe -m pip install -r requirements.txt` and
`.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`.
Activation is optional when using the interpreter's full path.

`/health` is a database-readiness check. HTTP 200 with `database: connected`
means `SELECT 1` succeeded; HTTP 503 means the database is not configured,
misconfigured, or disconnected. The response never includes raw connection
errors. This check does not create tables or prove any P0 feature works.
Standard `postgres://` and `postgresql://` URLs use the installed psycopg 3
driver; existing URL options such as `sslmode` are preserved.

## 2. Start the frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm ci --include=dev
```

Create `frontend/.env.local` with the following setting:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Then start the development server:

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## API URL convention

The agreed frontend API client will use `NEXT_PUBLIC_API_BASE_URL` to identify the backend API.
For local development, its value is `http://localhost:8000`.
Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser, so never put secrets in them.

## Environment configuration

The root `.env.example` lists shared configuration names and safe placeholder values.
Copy the relevant settings into the appropriate local environment file and supply real credentials only locally when required.
Do not commit `.env` files, real API keys, database credentials, or private financial data.

## Demo

Follow the steps and prompts in `docs/demo-script.md` to demonstrate the agreed Uber-edit and Dining-forecast scenarios.

The dashboard imports CSVs, filters transactions, saves manual category edits,
and displays monthly totals from the database. Gemini returns typed events and
proposals that require human confirmation. Dining forecasting uses a fitted
statistical baseline with chronological backtests and a budget comparison.
See the canonical `docs/api-contract.md`; public deployment remains pending.

## CSV / database / dashboard milestone

Review `backend/migrations/001_transactions.sql`, then explicitly initialize the
additive table (no schema changes occur on application startup):

```bash
cd backend
python -m app.db schema
python -m app.db migrate
```

The table is `flowledger_transactions`; existing team tables are not altered.
Use `backend/.env` for DATABASE_URL and set FRONTEND_ORIGIN to the exact browser
origin (for example http://localhost:4317). Set
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` in `frontend/.env.local` before
building. The frontend API URL is public configuration; never include database
or Gemini secrets in it.

Start FastAPI on port 8000 and build/start the frontend. Upload
`data/demo/transactions.csv`: 42 rows should import; a repeat import should skip
42 rows. The initial dashboard selects the latest imported month (September 2026
for this CSV), rather than presenting illustrative October contract totals as
real spending. Reload the page to verify persistence. Merchant filtering is a
case-insensitive literal substring match, so Uber also matches Uber Eats; this
does not decide which rows a Gemini edit request should select.

CSV limits are 2 MiB and 10,000 rows, with exact header order and UTF-8 encoding.
Invalid rows are skipped and reported; valid rows commit atomically. Signed
integer cents support refunds. Month boundaries use UTC. A mixed-currency month
returns a validation error rather than summing different currencies.

Duplicate identity is owner + normalized timestamp + merchant + cents + currency;
category is excluded so re-import does not undo an edit. Truly identical purchases
cannot be distinguished by these CSV columns and are treated as duplicates.

All routes use the backend-controlled DEMO_USER_ID (default demo-user-001). The UI
is explicitly a shared demo workspace, not production authentication; anyone
allowed to access the demo API shares that workspace. Client-supplied user IDs
cannot select another account. Do not expose private financial data through this
demo. Forecasts use only this account's saved history.

## Gemini proposals and human confirmation

`POST /agent/chat` follows `docs/api-contract.md` and returns typed events.
Gemini can call only `get_transactions` and `prepare_transaction_update`;
automatic tool execution is disabled, and confirmation is never exposed to the
model. The backend validates tool arguments and owner scope. A preview includes
a before/after category pair for every selected ID and expires after ten minutes.
Preparing a preview stores proposal metadata but does not edit transactions.

Review `backend/migrations/002_agent_proposals.sql` before explicitly running
`python -m app.db migrate-agent` with the private database configuration. This
creates only `flowledger_proposals` and `flowledger_confirmation_audit`. Neither
application startup nor the transaction migration adds these tables automatically.

Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) only on the backend. `GEMINI_MODEL`
optionally overrides the browser-tested `gemini-3.1-flash-lite` default. Missing credentials,
provider failures and bounded tool-loop failures return a safe 503; no fabricated
proposal or deterministic fallback is presented as Gemini output.

The dashboard's Ask FlowLedger panel displays each selected transaction and its
before/after category. Cancel dismisses an unconfirmed preview; its stored token
expires naturally. Only clicking Confirm changes sends `POST /agent/confirm`.
The same idempotency key is retained for an uncertain network retry. Confirmation
checks ownership, expiry and complete record snapshots/revisions, then applies
the full selection and writes a category-change audit atomically. Audit failure
rolls back all edits. Successful retries return the original response, including
after expiry; a key cannot be reused for another proposal. Tokens are hashed in
database storage, and neither tokens nor API keys are stored in the audit table.

The demo CSV's exact Uber rides already have category Transport. To demonstrate
a visible edit, request `Move all my Uber rides to Other. Exclude Uber Eats.`
Review the two exact Uber rows, cancel once to verify no change, ask again and
confirm, then reload. Request Transport afterward to restore the original demo.
`Uber purchases` is ambiguous; the assistant is instructed to ask whether Uber
Eats is included. The review table remains the authoritative selection preview.
The real Gemini smoke check verified this explicit rides-only request; safety
checks do not guarantee every model interpretation. Gemini can also call the
read-only `get_forecast` tool and receives actual forecast output.

The identity remains the agreed shared fictional demo account, not personal
authentication. Proposal state and confirmed audit records survive API restarts.
Expired pending proposals are retained; retention cleanup is a later deployment
decision. The chat is one request at a time, without persistent conversation history.

## Dining forecast and budget

`POST /ml/forecast` implements the approved forecast contract. The demo uses
`DINING_BUDGET_CENTS=5000` ($50 USD) and `DEMO_FORECAST_AS_OF=2026-10-10`.
The dashboard date is editable; Gemini's "this month" uses the configured demo
date unless the request gives another date. As-of includes that entire UTC day;
the horizon must equal the remaining days after it through month-end (21 for
October 10). The predicted period total is saved month-to-date net spending plus
estimated remaining spending, not an invented full-month total.

The baseline is genuinely fitted from the preceding six months of owner-scoped
database history on each request; it is not a fixture or an advanced forecasting
model. Three chronological backtests produce the reported average absolute error.
History gaps, fewer than six category transactions, or fewer than three positive
category months return the complete `insufficient_history` null state. Setting
`FORECAST_ENABLED=false` returns `not_trained`. Non-USD category transactions are
rejected because the demo budget is USD. Other categories have no configured
budget and return `budget_cents: null` when a forecast is available.

No new dependencies, tables, migrations or saved financial records are required.
The model refits after saved history changes, with a version derived from its
training data. See `docs/forecast-model.md` for fitting, evaluation and limitations.
The six Dining purchases in the seed CSV are sparse; the UI shows an error warning
and does not claim reliable financial advice. Missing imported purchases are not
included in spending to date.

## Production frontend build

For a public shared demo, set `PUBLIC_DEMO=true` on the backend and use one
Uvicorn worker. The in-memory guard allows one active chat, five chats per
minute, 50 chats per rolling 24 hours, 20 transaction/confirmation writes per
minute and 60 other requests per minute, globally across visitors. Rejections
return HTTP 429 with `Retry-After`; health checks and CORS preflight stay
available. Counts reset on process restart and are not shared across replicas.
These limits protect demo capacity, not authentication or private accounts.
Retain fictional data only. Restore demo category edits through the confirmed
agent flow; do not automatically reset the shared database at startup.

From the repository root:

```bash
npm run build
npm start
```

The root build installs the frontend lockfile with `npm ci --include=dev`, even
when the host sets `NODE_ENV=production` or omits development dependencies by
default. These dependencies are required to compile the app. Next.js builds with
Webpack and Tailwind 4 uses `@tailwindcss/postcss` via
`frontend/postcss.config.mjs`. Do not add a second Tailwind loader.

`npm start` delegates to `next start`, which reads the host's `PORT` environment
variable and binds to `0.0.0.0` by default. Keep `frontend/.next` and its runtime
dependencies in the deployed artifact. The root lockfile alone does not install
the frontend; this repository is not an npm workspace.

### Free Render frontend hosting

Use a Render Static Site with repository `ankurpan01/FlowLedger-AI` and the
reviewed deployment branch. Set root directory `frontend`, build command
`npm ci --include=dev && npm run build`, and publish directory `out`.
Set `STATIC_EXPORT=true` and `NEXT_PUBLIC_API_BASE_URL` to the actual HTTPS
backend URL before building. Only this public API address belongs in the
frontend environment; keep database and Gemini credentials on the backend.
The export is static HTML/CSS/JavaScript and needs no Node server. With
`STATIC_EXPORT` unset, the usual local build and `npm start` still work.

Create the Python API as a separate Render Free web service, rooted at `backend`:
build `pip install -r requirements.txt`; start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`; health path `/health`.
Use the existing Tiger Data database and enable `PUBLIC_DEMO=true`.
Set `FRONTEND_ORIGIN` to a comma-separated list of exact HTTPS origins for the
actual Render frontend and `https://flowledgerai.us`. No wildcard or URL paths.
Add `https://www.flowledgerai.us` only if that domain is also configured.

Connect the Porkbun-registered domain using Render's displayed custom-domain
DNS values after preview verification. Domain registration and app hosting are
separate services; the MLH free-domain offer does not require GoDaddy hosting.
Free backend instances sleep after 15 minutes idle and have shared monthly
usage limits. Static frontends do not have that backend cold-start behavior.
See [Render free services](https://render.com/docs/free) and
[Next.js on Render](https://render.com/docs/deploy-nextjs-app).

## Starter verification

```bash
npm --prefix frontend run lint
npm --prefix frontend audit --omit=dev
cd backend
python -m unittest discover -s tests -v
python -m pip check
```

Health tests use an isolated SQLite database and simulated failures. They do
not prove Tiger Data connectivity. Verify `/health` with the real private
configuration separately, then verify a production frontend HTTP response on
the host-assigned port and visually check Tailwind styling.

The full development dependency audit currently reports a high-severity
`braces` advisory propagated through the Next.js ESLint dependency chain.
Do not run `npm audit fix --force`: its proposed fix downgrades
`eslint-config-next` across major versions. Track remediation separately from
the build fix; a clean production-only audit does not clear development tooling.
