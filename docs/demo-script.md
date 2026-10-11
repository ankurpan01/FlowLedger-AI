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

**Current seed-data rehearsal:** The two exact `Uber` ride records already have
category `Transport`, while `Uber Eats` is `Dining`. The original prompt's
"Uber purchases" is ambiguous, so clarify whether food delivery is included.
For a visible rides-only change, use `Move all my Uber rides to Other. Exclude
Uber Eats.` Verify two before/after rows, cancel once, request the preview again,
then click Confirm changes. Refresh to verify persistence and request Transport
afterward to restore the original demo categories. Do not claim a same-category
preview demonstrates a category change. The final demo wording remains a team
decision; this rehearsal does not change the approved API contract.

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

**Approved forecast rehearsal:** Use October 10, 2026 and the $50 USD monthly
Dining budget. With the unchanged 42-row CSV, the fitted daily-mean baseline
estimates $17.64 remaining and $17.64 period total because no October purchases
are recorded. Its three-fold historical average error is $16.07; show the limited
history warning rather than treating the $32.36 budget gap as certain. Ask the
exact prompt above and verify a `get_forecast` result, explanatory text and no
confirmation proposal. These values are measured output, not contract examples;
imported data or category changes can alter them.

