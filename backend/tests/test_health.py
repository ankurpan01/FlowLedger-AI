import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import create_app


class HealthTests(unittest.TestCase):
    def test_multiple_explicit_frontend_origins_allow_preview_and_domain_only(self):
        origins = ["https://flowledgerai.us", "https://flowledger-web.onrender.com"]
        with patch.dict("os.environ", {"FRONTEND_ORIGIN": ", ".join(origins)}):
            with TestClient(create_app("")) as client:
                for origin in origins:
                    response = client.options("/agent/chat", headers={"Origin": origin,
                        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["access-control-allow-origin"], origin)
                rejected = client.options("/agent/chat", headers={"Origin": "https://unrelated.example",
                    "Access-Control-Request-Method": "POST"})
                self.assertEqual(rejected.status_code, 400)
                self.assertNotIn("access-control-allow-origin", rejected.headers)

    def test_missing_database_reports_unavailable_but_api_starts(self):
        with TestClient(create_app("")) as client:
            response = client.get("/health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["database"], "not_configured")
            self.assertEqual(client.get("/docs").status_code, 200)

    def test_invalid_url_is_not_exposed(self):
        with TestClient(create_app("invalid-private-connection-value")) as client:
            response = client.get("/health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["database"], "configuration_error")
            self.assertNotIn("private", response.text)

    def test_real_local_query_reports_connected(self):
        # SQLite only tests the health query path, not Tiger Data connectivity.
        with TestClient(create_app("sqlite://?check_same_thread=false")) as client:
            response = client.get("/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {
                "status": "ok", "service": "flowledger-api", "database": "connected",
            })

    def test_database_failure_does_not_leak_driver_exception(self):
        app = create_app("sqlite://")
        error = OperationalError("SELECT 1", {}, Exception("secret-password-and-host"))
        with TestClient(app) as client, patch.object(app.state.engine, "connect", side_effect=error):
            response = client.get("/health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["database"], "disconnected")
            self.assertNotIn("secret-password", response.text)

    def test_provider_urls_select_installed_psycopg_driver(self):
        for scheme in ("postgres", "postgresql", "postgresql+psycopg"):
            with self.subTest(scheme=scheme):
                app = create_app(f"{scheme}://demo:fake@localhost/demo?sslmode=require")
                self.assertEqual(app.state.engine.dialect.driver, "psycopg")
                self.assertEqual(app.state.engine.url.query["sslmode"], "require")
                app.state.engine.dispose()


if __name__ == "__main__":
    unittest.main()
