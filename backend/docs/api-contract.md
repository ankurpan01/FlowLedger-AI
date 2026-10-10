# FlowLedger API Contract

This document outlines the backend endpoints available for the frontend team.

## 1. Health Check
* **URL:** `/health`
* **Method:** `GET`
* **Purpose:** Verify the backend server is running.
* **Response:**
  {
    "status": "ok",
    "service": "flowledger-api"
  }

## 2. Get Ledger Entries (Coming Soon)
* **URL:** `/api/ledger`
* **Method:** `GET`
* **Purpose:** Retrieve all financial transactions for the user.
* **Response (Planned):**
  [
    {"id": 1, "amount": 50.00, "category": "Food", "date": "2026-10-09"}
  ]