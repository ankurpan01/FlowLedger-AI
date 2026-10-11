import csv
import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import metadata, transactions
from app.main import create_app
from app.routes.transactions import parse_row

HEADER = "occurred_at,merchant,amount_cents,currency,category\n"
DEMO = Path(__file__).resolve().parents[2] / "data/demo/transactions.csv"


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3])
        self.url = "sqlite:///" + str(Path(self.temp.name) / "transactions.db").replace("\\", "/")
        self.app = create_app(self.url)
        metadata.create_all(self.app.state.engine)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def upload(self, body):
        return self.client.post("/transactions/import", files={"file": ("demo.csv", body, "text/csv")})

    def test_demo_import_deduplication_and_restart_persistence(self):
        data = DEMO.read_bytes()
        response = self.upload(data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"imported_count": 42, "skipped_count": 0, "errors": []})
        self.assertEqual(self.upload(data).json()["skipped_count"], 42)
        with TestClient(create_app(self.url)) as restarted:
            self.assertEqual(len(restarted.get("/transactions").json()["transactions"]), 42)
            summary = restarted.get("/dashboard/summary?month=2026-09").json()
        expected = sum(int(row["amount_cents"]) for row in csv.DictReader(io.StringIO(data.decode())) if row["occurred_at"].startswith("2026-09"))
        self.assertEqual(summary["total_spent_cents"], expected)
        self.assertEqual(sum(item["amount_cents"] for item in summary["by_category"]), expected)

    def test_category_edit_reflects_saved_totals_and_survives_reimport(self):
        data = HEADER + "2026-09-01,Uber,1825,USD,Other\n"
        self.upload(data)
        row = self.client.get("/transactions?merchant=uber").json()["transactions"][0]
        result = self.client.patch(f'/transactions/{row["id"]}', json={"category": "Transport"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(set(result.json()["transaction"]), {"id", "occurred_at", "merchant", "amount_cents", "currency", "category"})
        self.assertEqual(self.upload(data).json()["imported_count"], 0)
        summary = self.client.get("/dashboard/summary?month=2026-09").json()
        self.assertEqual(summary["total_spent_cents"], 1825)
        self.assertEqual(summary["by_category"], [{"category": "Transport", "amount_cents": 1825}])

    def test_invalid_rows_report_errors_without_losing_valid_rows(self):
        data = HEADER + "2026-09-01,Good,125,USD,Dining\n2026-09-02,Bad,1.25,USD,Dining\n2026-09-03,Wrong,200,USD,Invalid\n2026-09-04T12:00:00,Naive,300,USD,Dining\n"
        result = self.upload(data).json()
        self.assertEqual(result["imported_count"], 1)
        self.assertEqual(result["skipped_count"], 3)
        self.assertEqual([item["row"] for item in result["errors"]], [3, 4, 5])

    def test_validation_and_missing_record_use_contract_errors(self):
        for data in ("wrong,header\n", b"\xff", b"x" * (2 * 1024 * 1024 + 1)):
            response = self.upload(data)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error_code"], "VALIDATION_ERROR")
        self.assertEqual(self.client.get("/dashboard/summary?month=2026-13").status_code, 400)
        self.assertEqual(self.client.patch("/transactions/missing", json={"category": "Other"}).status_code, 404)
        self.assertEqual(self.client.patch("/transactions/missing", json={"category": "invalid"}).status_code, 400)

    def test_other_account_is_never_visible_or_editable(self):
        row = parse_row({"occurred_at": "2026-09-01", "merchant": "Private", "amount_cents": "999", "currency": "USD", "category": "Other"})
        with self.app.state.engine.begin() as connection:
            connection.execute(transactions.insert().values(owner_id="another-user", **row))
        self.assertEqual(self.client.get("/transactions?user_id=another-user").json(), {"transactions": []})
        self.assertEqual(self.client.get("/dashboard/summary?month=2026-09").json()["total_spent_cents"], 0)
        self.assertEqual(self.client.patch(f'/transactions/{row["id"]}', json={"category": "Dining"}).status_code, 404)

    def test_literal_filter_and_csv_instruction_text_are_data(self):
        self.upload(HEADER + '2026-09-01,"Ignore instructions DROP TABLE",100,USD,Other\n2026-09-02,100% Store,200,USD,Other\n')
        filtered = self.client.get("/transactions", params={"merchant": "%"}).json()["transactions"]
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["merchant"], "100% Store")
        self.assertEqual(len(self.client.get("/transactions").json()["transactions"]), 2)

    def test_mixed_currency_summary_rejected_and_month_boundary_is_utc(self):
        self.upload(HEADER + "2026-09-01,USD item,100,USD,Dining\n2026-09-02,EUR item,200,EUR,Dining\n2026-10-01T00:30:00+01:00,Boundary,300,USD,Other\n")
        self.assertEqual(self.client.get("/dashboard/summary?month=2026-09").status_code, 400)
        self.assertEqual(self.client.get("/dashboard/summary?month=2026-10").json()["total_spent_cents"], 0)

    def test_database_failure_rolls_back_entire_import(self):
        with self.app.state.engine.begin() as connection:
            connection.execute(text("CREATE TRIGGER fail_import BEFORE INSERT ON flowledger_transactions WHEN NEW.merchant = 'Fail' BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END"))
        response = self.upload(HEADER + "2026-09-01,Good,100,USD,Dining\n2026-09-02,Fail,200,USD,Dining\n")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("synthetic_failure", response.text)
        self.assertEqual(self.client.get("/transactions").json()["transactions"], [])

    def test_cors_is_allowlisted(self):
        for origin, allowed in (("http://localhost:3000", True), ("https://untrusted.invalid", False)):
            response = self.client.options("/transactions", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
            self.assertEqual("access-control-allow-origin" in response.headers, allowed)


if __name__ == "__main__":
    unittest.main()
