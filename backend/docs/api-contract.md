# FlowLedger API Contract

This document outlines the backend endpoints available for the frontend team.

## 1. Health Check
* **URL:** `/health`
* **Method:** `GET`
* **Purpose:** Verify the backend server is running.

## 2. Get Ledger Entries
* **URL:** `/api/ledger`
* **Method:** `GET`
* **Purpose:** Retrieve all financial transactions.

## 3. Agent Chat (Gemini AI)
* **URL:** `/agent/chat`
* **Method:** `POST`
* **Purpose:** Send user prompt to Gemini and receive AI response.

## 4. Agent Action Confirmation
* **URL:** `/agent/confirm`
* **Method:** `POST`
* **Purpose:** Confirm and execute an action suggested by the AI agent.

## 5. ML Financial Forecast
* **URL:** `/ml/forecast`
* **Method:** `GET`
* **Purpose:** Retrieve predictive financial forecasting from the ML model.