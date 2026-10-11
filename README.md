# FlowLedger AI

FlowLedger AI is a team project for exploring AI-assisted financial insights.

## Prerequisites

- Python 3 installed
- Node.js and npm installed

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

Configure any required backend secrets in `backend/.env`.
Never commit real API keys or other private values.

## 2. Start the frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm install
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

The frontend uses `NEXT_PUBLIC_API_BASE_URL` to identify the backend API.
For local development, its value is `http://localhost:8000`.
Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser, so never put secrets in them.

## Environment configuration

The root `.env.example` lists shared configuration names and safe placeholder values.
Copy the relevant settings into the appropriate local environment file and supply real credentials only locally when required.
Do not commit `.env` files, real API keys, database credentials, or private financial data.

## Demo

Follow the steps and prompts in `docs/demo-script.md` to demonstrate the agreed Uber-edit and Dining-forecast scenarios.
