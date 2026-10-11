import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update

from app.agent import AgentService, ConfirmRequest, PrepareInput, ReadInput, digest
from app.db import audit, metadata, proposals, transactions
from app.main import create_app

HEADER = "occurred_at,merchant,amount_cents,currency,category\n"


class ScriptedSession:
    def __init__(self):
        self.step = 0

    def send(self, content):
        self.step += 1
        if self.step == 1:
            return {"calls": [{"name": "get_transactions", "inputs": {"merchant": "Uber"}}]}
        rows = content[0].function_response.response["transactions"]
        return {"calls": [{"name": "prepare_transaction_update", "inputs": {
            "transaction_ids": [row["id"] for row in rows if row["merchant"] == "Uber"], "new_category": "Transport",
        }}]}

    def close(self):
        pass


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3])
        self.url = "sqlite:///" + str(Path(self.temp.name) / "agent.db").replace("\\", "/")
        self.app = create_app(self.url, ScriptedSession)
        metadata.create_all(self.app.state.engine)
        self.client = TestClient(self.app)
        self.client.__enter__()
        response = self.client.post("/transactions/import", files={"file": ("demo.csv", HEADER +
            "2026-09-01,Uber,100,USD,Other\n2026-09-02,Uber,200,USD,Other\n2026-09-03,Uber Eats,300,USD,Dining\n", "text/csv")})
        self.assertEqual(response.json()["imported_count"], 3)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def rows(self):
        return self.client.get("/transactions").json()["transactions"]

    def proposal(self):
        response = self.client.post("/agent/chat", json={"message": "Move my Uber rides to Transport"})
        self.assertEqual(response.status_code, 200, response.text)
        return next(event for event in response.json()["events"] if event["type"] == "proposal")

    def confirm(self, proposal, key="confirm-1"):
        return self.client.post("/agent/confirm", json={"proposal_token": proposal["proposal_token"], "idempotency_key": key})

    def audit_count(self):
        with self.app.state.engine.connect() as connection:
            return connection.scalar(select(func.count()).select_from(audit))

    def test_preview_has_every_change_and_never_edits_until_confirmation(self):
        before = self.rows()
        proposal = self.proposal()
        self.assertEqual(self.rows(), before)
        selected = [row["id"] for row in before if row["merchant"] == "Uber"]
        self.assertCountEqual(proposal["selected_ids"], selected)
        self.assertEqual(len(proposal["changes"]), 2)
        for change in proposal["changes"]:
            self.assertEqual(change["before"], {"category": "Other"})
            self.assertEqual(change["after"], {"category": "Transport"})
        self.assertEqual(self.audit_count(), 0)
        response = self.confirm(proposal)
        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(response.json()["updated_ids"], selected)
        self.assertEqual(self.audit_count(), 1)
        after = self.rows()
        self.assertTrue(all(row["category"] == ("Transport" if row["merchant"] == "Uber" else "Dining") for row in after))
        summary = self.client.get("/dashboard/summary?month=2026-09").json()
        self.assertEqual(summary["total_spent_cents"], 600)
        self.assertEqual({item["category"]: item["amount_cents"] for item in summary["by_category"]}, {"Transport": 300, "Dining": 300})

    def test_restart_and_retry_replay_original_response_even_after_expiry(self):
        proposal = self.proposal()
        with TestClient(create_app(self.url, ScriptedSession)) as restarted:
            body = {"proposal_token": proposal["proposal_token"], "idempotency_key": "stable-key"}
            result = restarted.post("/agent/confirm", json=body)
            self.assertEqual(result.status_code, 200)
        with self.app.state.engine.begin() as connection:
            connection.execute(update(proposals).values(expires_at=datetime.now(timezone.utc) - timedelta(days=1)))
        self.assertEqual(self.confirm(proposal, "stable-key").json(), result.json())
        self.assertEqual(self.audit_count(), 1)
        self.assertEqual(self.confirm(proposal, "different-key").status_code, 409)

    def test_expiry_stale_record_and_change_back_are_rejected(self):
        proposal = self.proposal()
        with self.app.state.engine.begin() as connection:
            connection.execute(update(proposals).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        self.assertEqual(self.confirm(proposal).json()["error_code"], "PROPOSAL_EXPIRED")
        proposal = self.proposal()
        id = proposal["selected_ids"][0]
        self.client.patch(f"/transactions/{id}", json={"category": "Dining"})
        self.client.patch(f"/transactions/{id}", json={"category": "Other"})
        result = self.confirm(proposal)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json()["error_code"], "PROPOSAL_STALE")
        self.assertEqual(self.audit_count(), 0)
        self.assertTrue(all(row["category"] == "Other" for row in self.rows() if row["merchant"] == "Uber"))

    def test_wrong_account_cannot_read_prepare_or_confirm(self):
        proposal = self.proposal()
        foreign = AgentService(self.app.state.engine, "other-account", ScriptedSession)
        self.assertEqual(foreign.read(ReadInput()), [])
        with self.assertRaises(Exception) as caught:
            foreign.prepare(PrepareInput(transaction_ids=proposal["selected_ids"], new_category="Dining"), set(proposal["selected_ids"]))
        self.assertEqual(caught.exception.status_code, 403)
        with self.assertRaises(Exception) as caught:
            foreign.confirm(ConfirmRequest(proposal_token=proposal["proposal_token"], idempotency_key="key"))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self.audit_count(), 0)

    def test_confirmation_rolls_back_edits_status_and_audit_on_failure(self):
        proposal = self.proposal()
        before = self.rows()
        with self.app.state.engine.begin() as connection:
            connection.execute(text("CREATE TRIGGER fail_audit BEFORE INSERT ON flowledger_confirmation_audit BEGIN SELECT RAISE(ABORT, 'private_failure'); END"))
        response = self.confirm(proposal)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private_failure", response.text)
        self.assertEqual(self.rows(), before)
        with self.app.state.engine.connect() as connection:
            self.assertEqual(connection.scalar(select(proposals.c.status)), "pending")
        self.assertEqual(self.audit_count(), 0)

    def test_same_confirmation_key_cannot_apply_a_different_proposal(self):
        first, second = self.proposal(), self.proposal()
        self.assertEqual(self.confirm(first).status_code, 200)
        result = self.confirm(second)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json()["error_code"], "IDEMPOTENCY_CONFLICT")
        self.assertEqual(self.audit_count(), 1)

    def test_concurrent_same_key_retries_apply_once_and_return_same_result(self):
        proposal = self.proposal()
        body = ConfirmRequest(proposal_token=proposal["proposal_token"], idempotency_key="concurrent-key")
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.app.state.agent.confirm(body), range(8)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(self.audit_count(), 1)

    def test_changed_amount_invalidates_entire_bulk_proposal(self):
        proposal = self.proposal()
        with self.app.state.engine.begin() as connection:
            connection.execute(update(transactions).where(transactions.c.id == proposal["selected_ids"][1]).values(amount_cents=999))
        response = self.confirm(proposal)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(all(row["category"] == "Other" for row in self.rows() if row["merchant"] == "Uber"))
        self.assertEqual(self.audit_count(), 0)

    def test_model_cannot_confirm_use_unread_ids_or_inject_extra_arguments(self):
        before = self.rows()
        for call, expected in (
            ({"name": "confirm_action", "inputs": {}}, 400),
            ({"name": "execute_sql", "inputs": {"sql": "DROP TABLE"}}, 400),
            ({"name": "prepare_transaction_update", "inputs": {"transaction_ids": [before[0]["id"]], "new_category": "Transport"}}, 403),
            ({"name": "get_transactions", "inputs": {"user_id": "other-account"}}, 400),
            ({"name": "prepare_transaction_update", "inputs": {"transaction_ids": ["fake"], "new_category": "Invalid"}}, 400),
        ):
            with patch.object(ScriptedSession, "send", return_value={"calls": [call]}):
                result = self.client.post("/agent/chat", json={"message": "test"})
            self.assertEqual(result.status_code, expected)
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.audit_count(), 0)

    def test_duplicate_selection_deleted_record_and_token_tampering_rejected(self):
        ids = [row["id"] for row in self.rows()]
        with self.assertRaises(Exception) as caught:
            self.app.state.agent.prepare(PrepareInput(transaction_ids=[ids[0], ids[0]], new_category="Other"), set(ids))
        self.assertEqual(caught.exception.status_code, 400)
        proposal = self.proposal()
        with self.app.state.engine.begin() as connection:
            connection.execute(transactions.delete().where(transactions.c.id == proposal["selected_ids"][0]))
        self.assertEqual(self.confirm(proposal).status_code, 403)
        self.assertEqual(self.confirm({"proposal_token": "tampered-token-of-adequate-length"}).status_code, 403)
        self.assertEqual(self.audit_count(), 0)

    def test_missing_credentials_provider_failure_and_tool_loop_are_safe(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            with TestClient(create_app(self.url)) as real:
                response = real.post("/agent/chat", json={"message": "hello"})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["error_code"], "AI_SERVICE_UNAVAILABLE")
        with patch.object(ScriptedSession, "send", side_effect=RuntimeError("secret-provider-details")):
            response = self.client.post("/agent/chat", json={"message": "test"})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("secret-provider-details", response.text)
        with patch.object(ScriptedSession, "send", return_value={"calls": [{"name": "get_transactions", "inputs": {}}]}):
            response = self.client.post("/agent/chat", json={"message": "test"})
            self.assertEqual(response.status_code, 503)
        self.assertEqual(self.audit_count(), 0)

    def test_plain_message_has_no_proposal_and_tokens_are_hashed_at_rest(self):
        with patch.object(ScriptedSession, "send", return_value={"calls": [], "text": "Which category?"}):
            response = self.client.post("/agent/chat", json={"message": "Move Uber"})
            self.assertEqual(response.json(), {"events": [{"type": "message", "text": "Which category?"}]})
        proposal = self.proposal()
        with self.app.state.engine.connect() as connection:
            row = connection.execute(select(proposals)).mappings().one()
        self.assertEqual(row["token_hash"], digest(proposal["proposal_token"]))
        self.assertNotIn(proposal["proposal_token"], str(dict(row)))


if __name__ == "__main__":
    unittest.main()
