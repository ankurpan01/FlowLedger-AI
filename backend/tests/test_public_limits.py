import asyncio
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from app.main import create_app
from app.public_limits import PublicDemoLimits


class PublicLimitTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now, self.calls = 0, 0

        async def endpoint(scope, receive, send):
            self.calls += 1
            await JSONResponse({"ok": True})(scope, receive, send)

        self.endpoint = endpoint
        self.guard = PublicDemoLimits(endpoint, clock=lambda: self.now,
            chat_minute=1, chat_day=2, writes_minute=1, reads_minute=1)

    async def request(self, path="/agent/chat", method="POST", guard=None):
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await (guard or self.guard)({"type": "http", "method": method, "path": path}, receive, send)
        return next(item for item in messages if item["type"] == "http.response.start")

    async def test_minute_then_rolling_daily_cap_prevent_endpoint_execution(self):
        self.assertEqual((await self.request())["status"], 200)
        limited = await self.request()
        self.assertEqual(limited["status"], 429)
        self.assertIn((b"retry-after", b"60"), limited["headers"])
        self.assertEqual(self.calls, 1)
        self.now = 60
        self.assertEqual((await self.request())["status"], 200)
        self.now = 120
        self.assertEqual((await self.request())["status"], 429)
        self.assertEqual(self.calls, 2)
        self.now = 86400
        self.assertEqual((await self.request())["status"], 200)

    async def test_limits_are_global_and_write_read_chat_buckets_are_separate(self):
        self.assertEqual((await self.request())["status"], 200)
        self.assertEqual((await self.request("/transactions/one", "PATCH"))["status"], 200)
        self.assertEqual((await self.request("/agent/confirm"))["status"], 429)
        self.assertEqual((await self.request("/transactions", "GET"))["status"], 200)
        self.assertEqual((await self.request("/ml/forecast"))["status"], 429)

    async def test_health_and_preflight_are_available_when_buckets_exhausted(self):
        await self.request()
        for _ in range(3):
            self.assertEqual((await self.request("/health", "GET"))["status"], 200)
            self.assertEqual((await self.request("/agent/chat", "OPTIONS"))["status"], 200)
        self.assertEqual((await self.request())["status"], 429)

    async def test_parallel_chat_is_rejected_and_exception_releases_slot(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def blocked(scope, receive, send):
            started.set()
            await release.wait()
            raise RuntimeError("simulated provider failure")

        guard = PublicDemoLimits(blocked, clock=lambda: self.now)
        first = asyncio.create_task(self.request(guard=guard))
        await started.wait()
        self.assertEqual((await self.request(guard=guard))["status"], 429)
        release.set()
        with self.assertRaises(RuntimeError):
            await first
        guard.app = self.endpoint
        self.assertEqual((await self.request(guard=guard))["status"], 200)

    async def test_enabled_app_keeps_cors_headers_on_rate_limit_and_preflight(self):
        origin = "https://flowledgerai.us"
        with patch.dict("os.environ", {"PUBLIC_DEMO": "true", "FRONTEND_ORIGIN": origin}):
            with TestClient(create_app("")) as client:
                for _ in range(5):
                    self.assertEqual(client.post("/agent/chat", json={"message": "demo"}).status_code, 503)
                response = client.post("/agent/chat", json={"message": "demo"}, headers={"Origin": origin})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)
                self.assertIn("retry-after", response.headers)
                preflight = client.options("/agent/chat", headers={"Origin": origin,
                    "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
                self.assertEqual(preflight.status_code, 200)


if __name__ == "__main__":
    unittest.main()
