"""Bounded, single-process safeguards for the shared public demo, not authentication."""
import math
import threading
import time
from collections import deque

from starlette.responses import JSONResponse


class PublicDemoLimits:
    def __init__(self, app, clock=time.monotonic, chat_minute=5, chat_day=50,
                 writes_minute=20, reads_minute=60):
        self.app, self.clock = app, clock
        self.rules = {
            "chat": [(60, chat_minute, deque()), (86400, chat_day, deque())],
            "write": [(60, writes_minute, deque())],
            "read": [(60, reads_minute, deque())],
        }
        self.lock = threading.Lock()
        self.chat_active = False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or scope["path"] == "/health":
            return await self.app(scope, receive, send)
        path, method = scope["path"].rstrip("/"), scope["method"]
        group = "chat" if path == "/agent/chat" and method == "POST" else (
            "write" if method in {"POST", "PATCH"} and not path.startswith('/ml/') else "read")
        with self.lock:
            now = self.clock()
            waits = []
            for window, limit, hits in self.rules[group]:
                while hits and hits[0] <= now - window:
                    hits.popleft()
                if len(hits) >= limit:
                    waits.append(math.ceil(hits[0] + window - now))
            if group == "chat" and self.chat_active:
                waits.append(5)
            retry = max(waits, default=0)
            if not retry:
                for _, _, hits in self.rules[group]:
                    hits.append(now)
                if group == "chat":
                    self.chat_active = True
        if retry:
            response = JSONResponse({"error_code": "RATE_LIMITED",
                "message": "The shared demo is busy or has reached its request limit. Please try again later."},
                status_code=429, headers={"Retry-After": str(max(1, retry))})
            return await response(scope, receive, send)
        try:
            await self.app(scope, receive, send)
        finally:
            if group == "chat":
                with self.lock:
                    self.chat_active = False
