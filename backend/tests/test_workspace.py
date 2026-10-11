import io
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import func, select
from app.db import metadata, transactions, audit
from app.main import create_app
from app.planning import models
from app.documents import extract

DEMO = Path(__file__).resolve().parents[2] / 'data/demo/transactions.csv'
FORECAST = {'category': 'Dining', 'as_of': '2026-10-10', 'horizon_days': 21}


class EchoSession:
    prompts = []
    calls = 0
    fail_next = False

    def send(self, content):
        EchoSession.calls += 1
        EchoSession.prompts.append(content)
        if EchoSession.fail_next:
            EchoSession.fail_next = False
            raise RuntimeError('simulated unavailable provider')
        return {'text': 'A grounded test explanation.'}

    def close(self):
        pass


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[3])
        self.url = 'sqlite:///' + str(Path(self.temp.name) / 'workspace.db').replace('\\', '/')
        self.app = create_app(self.url, EchoSession)
        metadata.create_all(self.app.state.engine)
        self.client = TestClient(self.app)
        self.client.__enter__()
        EchoSession.prompts, EchoSession.calls, EchoSession.fail_next = [], 0, False
        result = self.client.post('/transactions/import', files={'file': ('demo.csv', DEMO.read_bytes(), 'text/csv')})
        self.assertEqual(result.status_code, 200, result.text)
        self.a, self.b = self.workspace(), self.workspace()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def workspace(self, seed=True):
        result = self.client.post('/workspaces', json={'name': 'Test workspace', 'seed_demo': seed})
        self.assertEqual(result.status_code, 200, result.text)
        return {'Authorization': 'Bearer ' + result.json()['workspace_key']}

    def rows(self, headers=None):
        return self.client.get('/transactions', headers=headers or self.a).json()['transactions']

    def preview(self, path, body):
        result = self.client.post(path, json=body, headers=self.a)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def confirm(self, proposal, key='stable-confirmation', headers=None):
        return self.client.post('/agent/confirm', headers=headers or self.a,
            json={'proposal_token': proposal['proposal_token'], 'idempotency_key': key})

    def test_workspace_isolation_and_invalid_credential(self):
        self.assertEqual(len(self.rows()), 42)
        self.assertTrue(set(r['id'] for r in self.rows()).isdisjoint(r['id'] for r in self.rows(self.b)))
        self.assertEqual(self.client.get('/planning').status_code, 401)
        self.assertEqual(self.client.get('/planning', headers={'Authorization': 'Bearer invalid'}).status_code, 401)
        foreign = self.rows(self.b)[0]['id']
        result = self.client.post('/transactions/category/preview', headers=self.a,
            json={'transaction_ids': [foreign], 'new_category': 'Other'})
        self.assertEqual(result.status_code, 403)

    def test_budget_preview_confirm_retry_and_cancel(self):
        p = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 7500})
        self.assertEqual(self.client.get('/planning', headers=self.a).json()['budgets'][0]['amount_cents'], 5000)
        self.assertEqual(self.confirm(p, headers=self.b).status_code, 403)
        saved = self.confirm(p)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.confirm(p).json(), saved.json())
        self.assertEqual(self.client.get('/planning', headers=self.a).json()['budgets'][0]['amount_cents'], 7500)
        self.assertEqual(self.client.get('/planning', headers=self.b).json()['budgets'][0]['amount_cents'], 5000)
        with self.app.state.engine.connect() as c:
            self.assertEqual(c.scalar(select(func.count()).select_from(audit)), 1)
        cancelled = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 9000})
        self.client.post('/proposals/cancel', headers=self.a, json={'proposal_token': cancelled['proposal_token']})
        self.assertEqual(self.confirm(cancelled, 'cancelled').status_code, 409)

    def test_stale_budget_and_goal_rejected(self):
        first = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 7500})
        second = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 9000})
        self.assertEqual(self.confirm(first).status_code, 200)
        self.assertEqual(self.confirm(second, 'stale').status_code, 409)
        goal = self.preview('/planning/goal/preview', {'name': 'Emergency fund', 'target_cents': 50000, 'progress_cents': 15000, 'deadline': '2027-01-01'})
        self.assertEqual(self.confirm(goal, 'goal').status_code, 200)
        goals = self.client.get('/planning', headers=self.a).json()['goals']
        self.assertEqual(goals[0]['progress_cents'], 15000)
        self.assertEqual(self.client.get('/planning', headers=self.b).json()['goals'], [])

    def test_concurrent_confirmation_creates_one_audit(self):
        p = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 6100})
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.confirm(p), range(2)))
        self.assertEqual([r.status_code for r in responses], [200, 200], [r.text for r in responses])
        with self.app.state.engine.connect() as c:
            self.assertEqual(c.scalar(select(func.count()).select_from(audit)), 1)

    def test_chat_persists_retries_and_followup_context_is_scoped(self):
        conversation = self.client.post('/conversations', headers=self.a).json()['id']
        body = {'message': 'Explain my spending patterns', 'conversation_id': conversation, 'request_id': 'turn-1'}
        result = self.client.post('/agent/chat', headers=self.a, json=body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.client.post('/agent/chat', headers=self.a, json=body).json(), result.json())
        self.assertEqual(EchoSession.calls, 1)
        body.update(message='What about last month?', request_id='turn-2')
        self.assertEqual(self.client.post('/agent/chat', headers=self.a, json=body).status_code, 200)
        self.assertIn('Explain my spending patterns', EchoSession.prompts[-1])
        self.assertEqual(self.client.get('/conversations/' + conversation, headers=self.b).status_code, 404)
        with TestClient(create_app(self.url, EchoSession)) as restarted:
            history = restarted.get('/conversations/' + conversation, headers=self.a).json()
            self.assertEqual(len(history['turns']), 2)
        self.client.patch('/workspaces/me', headers=self.a, json={'name': 'Test', 'remember_context': False})
        body.update(message='Explain compound interest', request_id='turn-3')
        self.client.post('/agent/chat', headers=self.a, json=body)
        self.assertEqual(EchoSession.prompts[-1], 'Explain compound interest')

    def test_failed_chat_can_retry_without_duplicate_turn(self):
        conversation = self.client.post('/conversations', headers=self.a).json()['id']
        body = {'message': 'Hello', 'conversation_id': conversation, 'request_id': 'retry-1'}
        EchoSession.fail_next = True
        self.assertEqual(self.client.post('/agent/chat', headers=self.a, json=body).status_code, 503)
        self.assertEqual(self.client.post('/agent/chat', headers=self.a, json=body).status_code, 200)
        history = self.client.get('/conversations/' + conversation, headers=self.a).json()['turns']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['status'], 'complete')

    def test_document_review_duplicate_import_and_account_isolation(self):
        raw = 'date,description,amount,category\n10/02/2026,Test Cafe,12.50,Dining\n10/02/2026,Test Cafe,12.50,Dining\n'
        result = self.client.post('/documents', headers=self.a, files={'file': ('statement.csv', raw, 'text/csv')})
        self.assertEqual(result.status_code, 200, result.text)
        doc = result.json()
        self.assertEqual(len(self.rows()), 42)
        self.assertEqual(doc['duplicates'], [False, True])
        self.assertEqual(self.client.get('/documents/' + doc['id'], headers=self.b).status_code, 404)
        p = self.preview('/documents/import/preview', {'document_id': doc['id'], 'rows': doc['rows']})
        saved = self.confirm(p)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['imported_count'], 1)
        self.assertEqual(saved.json()['skipped_count'], 1)
        self.assertEqual(len(self.rows()), 43)
        self.assertEqual(self.confirm(p).json(), saved.json())
        self.assertEqual(self.client.get('/documents/' + doc['id'], headers=self.a).json()['status'], 'imported')

    def test_xlsx_zero_amount_and_invalid_currency(self):
        workbook = Workbook()
        workbook.active.append(['date', 'description', 'amount'])
        workbook.active.append(['2026-10-01', 'Zero record', 0])
        out = io.BytesIO()
        workbook.save(out)
        rows, errors, _ = extract(out.getvalue(), '.xlsx')
        self.assertEqual(rows[0]['amount_cents'], 0)
        self.assertEqual(errors, [])
        rows, errors, _ = extract(b'date,description,amount,currency\n2026-10-01,Foreign,10,EUR\n', '.csv')
        self.assertEqual(rows, [])
        self.assertEqual(len(errors), 1)
        with self.assertRaises(Exception):
            extract(b'not a PDF', '.pdf')
        self.assertEqual(extract(b'Advice note: save a small amount every week.', '.txt')[0], [])

    def test_text_pdf_and_scanned_pdf_behavior(self):
        from types import SimpleNamespace
        from pypdf import PdfWriter
        pdf = PdfWriter()
        pdf.add_blank_page(width=300, height=300)
        raw = io.BytesIO()
        pdf.write(raw)
        with self.assertRaises(Exception):
            extract(raw.getvalue(), '.pdf')
        page = SimpleNamespace(extract_text=lambda: 'Date  Description  Amount\n2026-10-01  Test Cafe  12.50')
        with patch('pypdf.PdfReader', return_value=SimpleNamespace(is_encrypted=False, pages=[page])):
            rows, errors, _ = extract(b'fixture', '.pdf')
            self.assertEqual(rows[0]['amount_cents'], 1250)
            self.assertEqual(errors, [])

    def test_ai_document_import_requires_read_and_human_confirmation(self):
        doc = self.client.post('/documents', headers=self.a, files={'file': ('cafe.csv', 'date,description,amount\n2026-10-01,Test Cafe,12.50\n', 'text/csv')}).json()
        class DocumentSession:
            step = 0
            def send(self, content):
                self.step += 1
                if self.step == 1:
                    return {'calls': [{'name': 'get_financial_documents', 'inputs': {}}]}
                rows = content[0].function_response.response['documents'][0]['records']
                return {'calls': [{'name': 'prepare_document_import', 'inputs': {'document_id': doc['id'], 'rows': [{**r, 'category': 'Dining'} for r in rows]}}]}
            def close(self):
                pass
        from app.agent import AgentService
        identity = self.client.get('/workspaces/me', headers=self.a).json()['id']
        result = AgentService(self.app.state.engine, identity, DocumentSession).chat('Suggest categories and preview the cafe statement import')
        p = next(e for e in result['events'] if e['type'] == 'proposal')
        self.assertEqual(p['changes'][0]['after']['category'], 'Dining')
        self.assertEqual(len(self.rows()), 42)
        self.assertEqual(self.confirm(p).status_code, 200)
        self.assertEqual(len(self.rows()), 43)

    def test_bulk_preview_and_delete_are_confirmed_and_scoped(self):
        selected = [r['id'] for r in self.rows() if r['merchant'] == 'Uber']
        p = self.preview('/transactions/category/preview', {'transaction_ids': selected, 'new_category': 'Other'})
        self.assertEqual(self.confirm(p).status_code, 200)
        self.assertTrue(all(r['category'] == 'Other' for r in self.rows() if r['merchant'] == 'Uber'))
        deletion = self.preview('/transactions/preview', {'action': 'delete', 'transaction_ids': selected})
        self.assertEqual(len(self.rows()), 42)
        self.assertEqual(self.confirm(deletion, 'delete').status_code, 200)
        self.assertEqual(len(self.rows()), 40)
        self.assertEqual(len(self.rows(self.b)), 42)

    def test_real_model_artifact_reload_future_cutoff_and_budget_refresh(self):
        first = self.client.post('/ml/insights', headers=self.a, json=FORECAST)
        self.assertEqual(first.status_code, 200, first.text)
        data = first.json()
        self.assertEqual(len(data['evaluation']), 6)
        self.assertEqual(data['holdout']['month'], '2026-09')
        self.assertIsNone(data['risk_probability'])
        with self.app.state.engine.connect() as c:
            self.assertEqual(c.scalar(select(func.count()).select_from(models)), 1)
        with patch('app.predictive.train', side_effect=AssertionError('Cached inference must not refit')):
            self.assertEqual(self.client.post('/ml/insights', headers=self.a, json=FORECAST).json(), data)
        p = self.preview('/planning/budget/preview', {'category': 'Dining', 'amount_cents': 7000})
        self.confirm(p)
        updated = self.client.post('/ml/insights', headers=self.a, json=FORECAST).json()
        self.assertEqual(updated['forecast']['budget_cents'], 7000)
        self.assertEqual(updated['forecast']['model_version'], data['forecast']['model_version'])
        self.client.post('/transactions/import', headers=self.a, files={'file': ('future.csv', 'occurred_at,merchant,amount_cents,currency,category\n2026-10-20,Future Cafe,99999,USD,Dining\n', 'text/csv')})
        self.assertEqual(self.client.post('/ml/insights', headers=self.a, json=FORECAST).json(), updated)
        row = next(r for r in self.rows() if r['category'] == 'Dining' and r['occurred_at'].startswith('2026-09'))
        self.client.patch('/transactions/' + row['id'], headers=self.a, json={'category': 'Other'})
        invalidated = self.client.post('/ml/insights', headers=self.a, json=FORECAST).json()
        self.assertNotEqual(invalidated['forecast']['model_version'], data['forecast']['model_version'])


if __name__ == '__main__':
    unittest.main()
