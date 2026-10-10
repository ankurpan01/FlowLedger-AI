# FlowLedger AI Demo Script

## 1. Gemini Agentic AI — Transaction Editing

**Exact prompt:**

> Find all Uber purchases and move them to Transport.

**Expected demonstration:**

1. The user submits the prompt through the frontend chat interface.
2. The Gemini agent retrieves all matching Uber transactions.
3. The agent prepares a before/after preview showing each selected transaction and its proposed category change to `Transport`.
4. The frontend displays the proposed changes and waits for the user's explicit confirmation.
5. Only after the user confirms does the backend apply the updates.
6. The frontend displays the result of the confirmed operation.

**Safety requirement:** Preparing a proposal must not modify the database. Gemini must not autonomously confirm or apply transaction updates.

## 2. Predictive ML — Dining Spending Forecast

**Exact prompt:**

> Will my Dining spending exceed its budget this month?

**Expected demonstration:**

1. The user submits the prompt through the frontend chat interface.
2. The agent calls the ML forecasting capability for the `Dining` category using the agreed forecast date and horizon.
3. The forecasting service returns the predicted remaining spending, predicted period total, and budget when available.
4. The agent explains whether the prediction indicates that Dining spending is likely to exceed the budget.
5. If the model is not trained or there is insufficient history, the frontend and agent communicate that limitation rather than inventing a prediction.

**Important:** Use actual model output. Do not present fixture or null values as a trained prediction.

