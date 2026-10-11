import csv
import io
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from google.genai import types

from app.agent import GeminiSession
from app.db import audit, metadata, proposals, transactions
from app.main import create_app

DEMO = Path(__file__).resolve().parents[2] / "data/demo/transactions.csv"
REQUEST = {"category": "Dining", "as_of": "2026-10-10", "horizon_days": 21}
HEADER = "occurred_at,merchant,amount_cents,currency,category\n"


class ForecastSession:
    def __init__(self):
        self.step = 0

    def send(self, content):
        self.step += 1
        if self.step == 1:
            return {"calls": [{"name": "get_forecast", "id": "forecast-call-1", "inputs": REQUEST}]}
        assert content[0].function_response.id == "forecast-call-1"
        result = content[0].function_response.response
        assert result["budget_cents"] == 5000
        return {"calls": [], "text": "The baseline estimate is under budget, with limited history."}

    def close(self):
        pass


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict("os.environ", {"DINING_BUDGET_CENTS": "5000", "FORECAST_ENABLED": "true", "DEMO_USER_ID": "demo-user-001"})
        self.environment.start()
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3])
        self.url = "sqlite:///" + str(Path(self.temp.name) / "forecast.db").replace("\\", "/")
        self.app = create_app(self.url, ForecastSession)
        metadata.create_all(self.app.state.engine)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.upload(DEMO.read_bytes())

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()
        self.environment.stop()

    def upload(self, data):
        response = self.client.post("/transactions/import", files={"file": ("demo.csv", data, "text/csv")})
        self.assertEqual(response.status_code, 200)

    def forecast(self, **overrides):
        return self.client.post("/ml/forecast", json=REQUEST | overrides)

    def test_seed_forecast_and_walk_forward_error_match_independent_arithmetic(self):
        data = list(csv.DictReader(io.StringIO(DEMO.read_text())))
        monthly = [sum(int(row["amount_cents"]) for row in data if row["category"] == "Dining" and row["occurred_at"].startswith(f"2026-{month:02d}")) for month in range(4, 10)]
        days = [30, 31, 30, 31, 31, 30]
        rounding = lambda value: int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        prediction = rounding(Decimal(sum(monthly)) / sum(days) * 21)
        errors = [rounding(Decimal(sum(monthly[:index])) / sum(days[:index]) * (days[index] - 10)) for index in range(3, 6)]
        expected_mae = rounding(Decimal(sum(errors)) / len(errors))
        response = self.forecast()
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["data_quality"], "sufficient")
        self.assertEqual(result["forecast_remaining_cents"], prediction)
        self.assertEqual(result["predicted_period_total_cents"], prediction)
        self.assertEqual(result["backtest_mae_cents"], expected_mae)
        self.assertEqual(result["budget_cents"], 5000)
        self.assertTrue(result["model_version"].startswith("daily-mean-v1-"))
        self.assertEqual(prediction, 1764)
        self.assertEqual(expected_mae, 1607)

    def test_current_spending_is_added_but_future_rows_cannot_leak_into_training(self):
        original = self.forecast().json()
        self.upload(HEADER + "2026-10-05,Current Dining,1000,USD,Dining\n2026-10-20,Future Dining,99999,USD,Dining\n")
        updated = self.forecast().json()
        self.assertEqual(updated["forecast_remaining_cents"], original["forecast_remaining_cents"])
        self.assertEqual(updated["predicted_period_total_cents"], original["predicted_period_total_cents"] + 1000)
        self.assertEqual(updated["model_version"], original["model_version"])
        self.assertEqual(updated["backtest_mae_cents"], original["backtest_mae_cents"])

    def test_saved_history_edits_refit_model_and_category_removal_can_reduce_quality(self):
        original = self.forecast().json()
        with self.app.state.engine.begin() as connection:
            connection.execute(update(transactions).where(transactions.c.merchant == "Uber Eats").values(amount_cents=10000))
        changed = self.forecast().json()
        self.assertNotEqual(changed["model_version"], original["model_version"])
        self.assertGreater(changed["forecast_remaining_cents"], original["forecast_remaining_cents"])
        id = next(row["id"] for row in self.client.get("/transactions").json()["transactions"] if row["merchant"] == "Uber Eats")
        self.client.patch(f"/transactions/{id}", json={"category": "Other"})
        self.assertEqual(self.forecast().json()["data_quality"], "insufficient_history")

    def test_missing_history_and_disabled_model_return_complete_null_contract(self):
        with self.app.state.engine.begin() as connection:
            connection.execute(transactions.delete())
        missing = self.forecast().json()
        self.assertEqual(missing["data_quality"], "insufficient_history")
        self.assertTrue(all(missing[key] is None for key in ("forecast_remaining_cents", "predicted_period_total_cents", "budget_cents", "model_version", "backtest_mae_cents")))
        with patch.dict("os.environ", {"FORECAST_ENABLED": "false"}):
            disabled = self.forecast().json()
        self.assertEqual(disabled["data_quality"], "not_trained")
        self.assertEqual(set(disabled), set(missing))

    def test_invalid_dates_horizons_categories_and_client_identity_are_rejected(self):
        for body in ({"as_of": "2026-02-30"}, {"horizon_days": 20}, {"horizon_days": "21"},
                     {"category": "Invalid"}, {"user_id": "other-owner"}, {"budget_cents": 1}, {"as_of": "0001-01-01"}):
            response = self.forecast(**body)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error_code"], "VALIDATION_ERROR")

    def test_other_owner_never_influences_model_and_missing_budget_is_not_invented(self):
        original = self.forecast().json()
        with self.app.state.engine.begin() as connection:
            connection.execute(update(transactions).values(owner_id="other-owner"))
        self.assertEqual(self.forecast().json()["data_quality"], "insufficient_history")
        with self.app.state.engine.begin() as connection:
            connection.execute(update(transactions).values(owner_id="demo-user-001"))
        self.assertEqual(self.forecast().json(), original)
        groceries = self.forecast(category="Groceries").json()
        self.assertEqual(groceries["data_quality"], "sufficient")
        self.assertIsNone(groceries["budget_cents"])

    def test_non_usd_and_invalid_budget_are_safe_errors(self):
        self.upload(HEADER + "2026-10-05,Euro Dining,100,EUR,Dining\n")
        self.assertEqual(self.forecast().status_code, 400)
        with self.app.state.engine.begin() as connection:
            connection.execute(transactions.delete().where(transactions.c.currency == "EUR"))
        with patch.dict("os.environ", {"DINING_BUDGET_CENTS": "private-invalid-value"}):
            response = self.forecast()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-invalid-value", response.text)

    def test_leap_day_month_end_and_utc_cutoff(self):
        with self.app.state.engine.begin() as connection:
            connection.execute(transactions.delete())
        data = HEADER + "".join(f"{month}-01,Statement,1,USD,Other\n{month}-05,Dining,3100,USD,Dining\n" for month in ("2023-08", "2023-09", "2023-10", "2023-11", "2023-12", "2024-01"))
        data += "2024-02-11T00:30:00+01:00,UTC Boundary,1000,USD,Dining\n"
        self.upload(data)
        result = self.forecast(as_of="2024-02-10", horizon_days=19).json()
        self.assertEqual(result["data_quality"], "sufficient")
        self.assertEqual(result["predicted_period_total_cents"] - result["forecast_remaining_cents"], 1000)
        result = self.forecast(as_of="2024-02-29", horizon_days=0).json()
        self.assertEqual(result["forecast_remaining_cents"], 0)
        self.assertEqual(result["predicted_period_total_cents"], 1000)

    def test_gemini_forecast_tool_returns_real_result_without_proposal_or_writes(self):
        before = self.client.get("/transactions").json()
        response = self.client.post("/agent/chat", json={"message": "Will my Dining spending exceed its budget this month?"})
        self.assertEqual(response.status_code, 200)
        events = response.json()["events"]
        self.assertEqual([event["type"] for event in events], ["tool_call", "result", "message"])
        self.assertEqual(events[0]["name"], "get_forecast")
        self.assertEqual(events[0]["inputs"], REQUEST)
        self.assertEqual(events[1]["data"]["forecast"], self.forecast().json())
        self.assertEqual(self.client.get("/transactions").json(), before)
        with self.app.state.engine.connect() as connection:
            for table in (audit, proposals):
                self.assertEqual(connection.scalar(select(func.count()).select_from(table)), 0)

    def test_explanation_failure_preserves_forecast_without_edits(self):
        original_send = ForecastSession.send

        def unavailable_explanation(session, content):
            if session.step:
                raise RuntimeError("private-provider-details")
            return original_send(session, content)

        before = self.client.get("/transactions").json()
        with patch.object(ForecastSession, "send", unavailable_explanation):
            response = self.client.post("/agent/chat", json={"message": "Dining forecast?"})
        self.assertEqual(response.status_code, 200)
        events = response.json()["events"]
        self.assertEqual(events[1]["data"]["forecast"], self.forecast().json())
        self.assertIn("explanation is unavailable", events[2]["text"])
        self.assertNotIn("private-provider-details", response.text)
        self.assertEqual(self.client.get("/transactions").json(), before)

    def test_provider_failure_before_tool_result_remains_safe_error(self):
        with patch.object(ForecastSession, "send", side_effect=RuntimeError("private-provider-details")):
            response = self.client.post("/agent/chat", json={"message": "Dining forecast?"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error_code"], "AI_SERVICE_UNAVAILABLE")
        self.assertNotIn("private-provider-details", response.text)

    def test_gemini_adapter_preserves_provider_tool_call_id(self):
        part = types.Part(function_call=types.FunctionCall(
            name="get_forecast", id="provider-call-123", args=REQUEST))
        response = types.GenerateContentResponse(candidates=[types.Candidate(
            content=types.Content(role="model", parts=[part]))])
        session = object.__new__(GeminiSession)
        session.chat = SimpleNamespace(send_message=lambda content: response)
        self.assertEqual(session.send("forecast?")["calls"][0]["id"], "provider-call-123")

    def test_provider_rate_limit_explains_retry_without_private_details(self):
        error = RuntimeError("private-provider-details")
        error.code = 429
        with patch.object(ForecastSession, "send", side_effect=error):
            response = self.client.post("/agent/chat", json={"message": "Dining forecast?"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("rate limited", response.json()["message"])
        self.assertNotIn("private-provider-details", response.text)


if __name__ == "__main__":
    unittest.main()
