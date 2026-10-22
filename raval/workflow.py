"""Persistent orchestration shared by the local workbench and Telegram adapter.

The model/finance boundary lives in quote_engine. This layer owns conversation
expiry, request idempotency and the audit history, without external side effects.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from model_gateway import build_gateway
from quote_engine import QuoteEngine

BASE_DIR = Path(__file__).resolve().parent
CONTEXT_TTL_SECONDS = 15 * 60
MAX_TEXT_LENGTH = 2000

try:
    TEHRAN = ZoneInfo("Asia/Tehran")
except ZoneInfoNotFoundError:  # Windows can lack IANA tzdata; present-day Tehran.
    TEHRAN = timezone(timedelta(hours=3, minutes=30), name="Asia/Tehran")


class RequestValidationError(ValueError):
    """A bounded, public-safe validation error."""


class DuplicateRequestError(RequestValidationError):
    """A request ID has already been used for different content."""


def validate_identifier(value: object, name: str, maximum: int = 100) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,%d}" % maximum, value):
        raise RequestValidationError(f"{name} معتبر نیست.")
    return value


class Workflow:
    def __init__(self, csv_path=None, db_path=None, gateway=None):
        self.csv_path = Path(csv_path or os.getenv("QUOTE_CSV_PATH") or BASE_DIR / "data/prices.csv").resolve()
        self.db_path = Path(db_path or os.getenv("QUOTE_DB_PATH") or BASE_DIR / ".runtime/workflow.sqlite3").resolve()
        self.gateway = gateway if gateway is not None else build_gateway()
        self.annual_rate = os.getenv("QUOTE_ANNUAL_RATE", "23")
        self.engine = QuoteEngine(self.csv_path, annual_rate=self.annual_rate, gateway=self.gateway)
        self.lock = threading.RLock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._initialize()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=30000")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _initialize(self):
        with self._connect() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS contexts (
                    chat_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requests (
                    chat_id TEXT NOT NULL,
                    request_id TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    input_text TEXT NOT NULL,
                    response TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (chat_id, request_id)
                );
                CREATE INDEX IF NOT EXISTS request_history
                    ON requests(chat_id, created_at DESC);
            """)
        try:
            self.db_path.chmod(0o600)
        except OSError:
            pass

    def handle(self, text, chat_id="demo", request_id=None):
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_LENGTH:
            raise RequestValidationError("پیام باید بین ۱ تا ۲۰۰۰ نویسه باشد.")
        text = text.strip()
        chat_id = validate_identifier(chat_id, "شناسهٔ گفت‌وگو")
        request_id = validate_identifier(request_id or uuid.uuid4().hex, "شناسهٔ درخواست", 120)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        now = time.time()
        # Serializes model execution for one local process. BEGIN IMMEDIATE also
        # protects dedup if the optional bot and workbench share this database.
        with self.lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            previous = conn.execute(
                "SELECT input_hash, response FROM requests WHERE chat_id=? AND request_id=?",
                (chat_id, request_id),
            ).fetchone()
            if previous:
                if previous["input_hash"] != digest:
                    raise DuplicateRequestError("این شناسه قبلاً برای پیام دیگری استفاده شده است؛ پیام جدید را دوباره بفرستید.")
                result = json.loads(previous["response"])
                result["cached"] = True
                return result
            saved = conn.execute("SELECT payload, updated_at FROM contexts WHERE chat_id=?", (chat_id,)).fetchone()
            context = json.loads(saved["payload"]) if saved and now - saved["updated_at"] < CONTEXT_TTL_SECONDS else None
            result = self.engine.process(text, context=context, request_id=request_id)
            result.update({
                "request_id": request_id,
                "timestamp": datetime.fromtimestamp(now, TEHRAN).isoformat(timespec="seconds"),
                "cached": False,
            })
            conn.execute(
                "INSERT INTO contexts(chat_id,payload,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
                (chat_id, json.dumps(result.get("context", {}), ensure_ascii=False), now),
            )
            conn.execute(
                "INSERT INTO requests(chat_id,request_id,input_hash,input_text,response,created_at) VALUES(?,?,?,?,?,?)",
                (chat_id, request_id, digest, text, json.dumps(result, ensure_ascii=False), now),
            )
            return result

    def history(self, chat_id="demo", limit=30):
        chat_id = validate_identifier(chat_id, "شناسهٔ گفت‌وگو")
        limit = max(1, min(50, int(limit)))
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT input_text,response FROM requests WHERE chat_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (chat_id, limit),
            ).fetchall()
        return [{"text": row["input_text"], "response": json.loads(row["response"])} for row in reversed(rows)]

    def reset(self, chat_id="demo"):
        chat_id = validate_identifier(chat_id, "شناسهٔ گفت‌وگو")
        with self.lock, self._connect() as conn:
            conn.execute("DELETE FROM contexts WHERE chat_id=?", (chat_id,))
            conn.execute("DELETE FROM requests WHERE chat_id=?", (chat_id,))
        return {"ok": True}

