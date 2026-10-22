"""Opt-in Telegram test adapter. Importing this module makes no network calls.

Run only with a dedicated bot token and an explicit private-chat allowlist.
There is one send attempt per accepted update. An uncertain delivery remains in
the durable journal for human review: neither a timeout nor a restart resends it.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_STATE_PATH = BASE_DIR / ".runtime/telegram.sqlite3"
MAX_RESPONSE_BYTES = 1_048_576
MAX_INPUT_LENGTH = 2000
MAX_MESSAGE_LENGTH = 4096
MAX_CHAT_ID = 2**52 - 1

_ERRORS = {
    "token": "توکن ربات آزمایشی معتبر تنظیم نشده است.",
    "allowlist": "شناسهٔ عددی گفت‌وگوهای خصوصی مجاز را با کاما مشخص کنید؛ فهرست خالی مجاز نیست.",
    "configuration": "پیکربندی آداپتور تلگرام معتبر نیست.",
    "webhook": "این ربات وب‌هوک فعال دارد؛ آداپتور متوقف شد و وب‌هوک را تغییر نداد.",
    "already_running": "یک پردازش دیگر همین دفتر ارسال را استفاده می‌کند؛ اجرای دوم متوقف شد.",
    "wrong_bot": "این دفتر ارسال متعلق به ربات دیگری است؛ مسیر جداگانه انتخاب کنید.",
    "timeout": "مهلت ارتباط تلگرام تمام شد.",
    "transport": "ارتباط تلگرام موفق نبود.",
    "response": "پاسخ سرویس تلگرام معتبر نبود.",
    "api_rejected": "تلگرام درخواست را نپذیرفت؛ جزئیات حساس ثبت نشد.",
    "delivery_unknown": "نتیجهٔ ارسال مشخص نیست؛ برای بررسی انسانی ثبت شد و تکرار نمی‌شود.",
    "storage": "دفتر پایدار ارسال در دسترس نیست؛ برای جلوگیری از ارسال تکراری، ربات متوقف شد.",
}


class TelegramError(RuntimeError):
    """Public-safe error. No upstream description, request URL, or token."""

    def __init__(self, code="response", *, ambiguous=False, retry_after=None):
        self.code = code if code in _ERRORS else "response"
        self.ambiguous = bool(ambiguous)
        self.retry_after = retry_after if type(retry_after) is int and 1 <= retry_after <= 60 else None
        super().__init__(_ERRORS[self.code])


def parse_allowed_chat_ids(value):
    if not isinstance(value, str) or not value.strip():
        raise TelegramError("allowlist")
    parts = [part.strip() for part in value.split(",")]
    if len(parts) > 100 or any(not re.fullmatch(r"[1-9][0-9]{0,15}", part) for part in parts):
        raise TelegramError("allowlist")
    result = frozenset(int(part) for part in parts)
    if any(chat_id > MAX_CHAT_ID for chat_id in result):
        raise TelegramError("allowlist")
    return result


def _valid_update_id(value):
    return type(value) is int and 0 <= value < 2**63 - 1


def _message_length(text):
    # A conservative bound also protects non-BMP characters in Telegram text.
    try:
        return len(text.encode("utf-16-le")) // 2
    except UnicodeError:
        return MAX_MESSAGE_LENGTH + 1


def _reject_constant(_value):
    raise ValueError("Non-finite JSON constant")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TelegramClient:
    def __init__(self, token, transport=None):
        if not isinstance(token, str) or not re.fullmatch(r"[1-9][0-9]{0,19}:[A-Za-z0-9_-]{20,256}", token):
            raise TelegramError("token")
        self._token = token
        self.bot_identity = token.split(":", 1)[0]
        self._transport = transport or self._http

    def _http(self, method, payload, timeout):
        sending = method == "sendMessage"
        try:
            request = Request(
                "https://api.telegram.org/bot" + self._token + "/" + method,
                data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method="POST",
            )
            with build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise TelegramError("response", ambiguous=sending)
            return json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        except TelegramError:
            raise
        except (TimeoutError, socket.timeout):
            raise TelegramError("delivery_unknown" if sending else "timeout", ambiguous=sending) from None
        except HTTPError as error:
            uncertain = sending and (error.code >= 500 or error.code in (408, 425) or 300 <= error.code < 400)
            error.close()
            raise TelegramError("delivery_unknown" if uncertain else "api_rejected", ambiguous=uncertain) from None
        except URLError as error:
            code = "timeout" if isinstance(error.reason, (TimeoutError, socket.timeout)) else "transport"
            raise TelegramError("delivery_unknown" if sending else code, ambiguous=sending) from None
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise TelegramError("response", ambiguous=sending) from None
        except OSError:
            raise TelegramError("delivery_unknown" if sending else "transport", ambiguous=sending) from None

    def _call(self, method, payload, timeout=15):
        sending = method == "sendMessage"
        try:
            data = self._transport(method, payload, timeout)
        except TelegramError:
            raise
        except (TimeoutError, socket.timeout):
            raise TelegramError("delivery_unknown" if sending else "timeout", ambiguous=sending) from None
        except Exception:
            raise TelegramError("delivery_unknown" if sending else "transport", ambiguous=sending) from None
        if not isinstance(data, dict) or type(data.get("ok")) is not bool:
            raise TelegramError("response", ambiguous=sending)
        if data["ok"] is False:
            error_code = data.get("error_code")
            uncertain = sending and (type(error_code) is not int or error_code >= 500 or error_code in (408, 425))
            parameters = data.get("parameters")
            retry_after = parameters.get("retry_after") if isinstance(parameters, dict) else None
            raise TelegramError("delivery_unknown" if uncertain else "api_rejected", ambiguous=uncertain, retry_after=retry_after)
        if "result" not in data:
            raise TelegramError("response", ambiguous=sending)
        return data["result"]

    def get_webhook_info(self):
        result = self._call("getWebhookInfo", {}, timeout=10)
        if not isinstance(result, dict) or not isinstance(result.get("url"), str):
            raise TelegramError("response")
        return result

    def get_updates(self, offset, timeout=25):
        if type(offset) is not int or offset < 0 or type(timeout) is not int or not 1 <= timeout <= 50:
            raise TelegramError("configuration")
        result = self._call(
            "getUpdates",
            {"offset": offset, "timeout": timeout, "limit": 100, "allowed_updates": ["message"]},
            timeout=timeout + 10,
        )
        if (
            not isinstance(result, list)
            or len(result) > 100
            or any(not isinstance(update, dict) or not _valid_update_id(update.get("update_id")) for update in result)
        ):
            raise TelegramError("response")
        return result

    def send_message(self, chat_id, text):
        if type(chat_id) is not int or not 0 < chat_id <= MAX_CHAT_ID or not isinstance(text, str) or not text or _message_length(text) > MAX_MESSAGE_LENGTH:
            raise TelegramError("configuration")
        result = self._call(
            "sendMessage",
            {"chat_id": chat_id, "text": text, "link_preview_options": {"is_disabled": True}},
            timeout=15,
        )
        if (
            not isinstance(result, dict)
            or type(result.get("message_id")) is not int
            or result["message_id"] <= 0
            or not isinstance(result.get("chat"), dict)
            or type(result["chat"].get("id")) is not int
            or result["chat"]["id"] != chat_id
        ):
            raise TelegramError("response", ambiguous=True)
        return result


class TelegramState:
    """SQLite inbox/outbox journal with atomic final state + polling offset."""

    def __init__(self, path=DEFAULT_STATE_PATH, bot_identity=None):
        self.path = Path(path).resolve()
        self._runner_lock = None
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self._connect() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS telegram_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO telegram_meta(key,value) VALUES('offset','0');
                CREATE TABLE IF NOT EXISTS telegram_deliveries (
                    update_id INTEGER PRIMARY KEY,
                    chat_id INTEGER,
                    status TEXT NOT NULL CHECK(status IN ('processing','pending','sent','needs_review','failed','skipped')),
                    reply TEXT,
                    error_code TEXT,
                    remote_message_id INTEGER,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
            """)
            if bot_identity is not None:
                if not isinstance(bot_identity, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", bot_identity):
                    raise TelegramError("configuration")
                conn.execute("BEGIN IMMEDIATE")
                saved = conn.execute("SELECT value FROM telegram_meta WHERE key='bot_identity'").fetchone()
                if saved and saved["value"] != bot_identity:
                    raise TelegramError("wrong_bot")
                conn.execute("INSERT OR IGNORE INTO telegram_meta(key,value) VALUES('bot_identity',?)", (bot_identity,))
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=10000")
            conn.execute("PRAGMA synchronous=FULL")
            with conn:
                yield conn
        finally:
            conn.close()

    def acquire_runner(self):
        if self._runner_lock is not None:
            return
        # A separate SQLite lock database provides a portable OS-backed lock.
        # The transaction disappears after a crash; it never blocks the journal.
        lock_path = Path(str(self.path) + ".runner-lock")
        conn = None
        try:
            conn = sqlite3.connect(lock_path, timeout=0)
            conn.execute("CREATE TABLE IF NOT EXISTS runner_lock (id INTEGER PRIMARY KEY)")
            conn.commit()
            conn.execute("BEGIN EXCLUSIVE")
            self._runner_lock = conn
            try:
                lock_path.chmod(0o600)
            except OSError:
                pass
        except sqlite3.OperationalError:
            if conn is not None:
                conn.close()
            raise TelegramError("already_running") from None

    def release_runner(self):
        if self._runner_lock is not None:
            self._runner_lock.rollback()
            self._runner_lock.close()
            self._runner_lock = None

    @property
    def offset(self):
        with self._connect() as conn:
            return int(conn.execute("SELECT value FROM telegram_meta WHERE key='offset'").fetchone()["value"])

    @staticmethod
    def _advance(conn, update_id):
        conn.execute("UPDATE telegram_meta SET value=CAST(MAX(CAST(value AS INTEGER),?) AS TEXT) WHERE key='offset'", (update_id + 1,))

    def claim(self, update_id, chat_id):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = int(conn.execute("SELECT value FROM telegram_meta WHERE key='offset'").fetchone()["value"])
            if update_id < current:
                return False
            now = time.time()
            cursor = conn.execute(
                "INSERT OR IGNORE INTO telegram_deliveries(update_id,chat_id,status,created_at,updated_at) VALUES(?,?,'processing',?,?)",
                (update_id, chat_id, now, now),
            )
            return cursor.rowcount == 1

    def skip(self, update_id, code):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            now = time.time()
            conn.execute(
                "INSERT OR IGNORE INTO telegram_deliveries(update_id,status,error_code,created_at,updated_at) VALUES(?,'skipped',?,?,?)",
                (update_id, code, now, now),
            )
            self._advance(conn, update_id)

    def prepare(self, update_id, reply, error_code=None):
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE telegram_deliveries SET status='pending',reply=?,error_code=?,updated_at=? WHERE update_id=? AND status='processing'",
                (reply, error_code, time.time(), update_id),
            )
            if cursor.rowcount != 1:
                raise TelegramError("storage")

    def finish(self, update_id, status, error_code=None, remote_message_id=None):
        if status not in ("sent", "needs_review", "failed"):
            raise TelegramError("storage")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                "UPDATE telegram_deliveries SET status=?,error_code=COALESCE(?,error_code),remote_message_id=?,updated_at=? "
                "WHERE update_id=? AND status='pending'",
                (status, error_code, remote_message_id, time.time(), update_id),
            )
            if cursor.rowcount != 1:
                raise TelegramError("storage")
            self._advance(conn, update_id)

    def recover_pending(self):
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute("SELECT update_id FROM telegram_deliveries WHERE status IN ('processing','pending')").fetchall()
            conn.execute(
                "UPDATE telegram_deliveries SET status='needs_review',error_code='interrupted',updated_at=? WHERE status IN ('processing','pending')",
                (time.time(),),
            )
            if rows:
                self._advance(conn, max(row["update_id"] for row in rows))
            return len(rows)

    def get(self, update_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM telegram_deliveries WHERE update_id=?", (update_id,)).fetchone()
        return dict(row) if row else None

    def review(self):
        with self._connect() as conn:
            return self._review_rows(conn)

    @staticmethod
    def _review_rows(conn):
        rows = conn.execute(
            "SELECT update_id,chat_id,status,error_code,reply,created_at,updated_at "
            "FROM telegram_deliveries WHERE status IN ('needs_review','failed','pending','processing') ORDER BY update_id LIMIT 100"
        ).fetchall()
        return [dict(row) for row in rows]

    @classmethod
    def review_file(cls, path):
        path = Path(path).resolve()
        if not path.exists():
            return []
        conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            return cls._review_rows(conn)
        finally:
            conn.close()


def _mode_banner(mode):
    labels = {
        "fixture": "قواعد محلی؛ بدون تماس با مدل زنده",
        "live": "مدل زنده برای استخراج؛ محاسبه با کد",
        "fallback": "قواعد جایگزین محلی؛ مدل در دسترس نیست",
    }
    return "نسخهٔ آزمایشی روال · قیمت‌های نمونهٔ تسک\nحالت: " + labels.get(mode, labels["fixture"]) + "\n\n"


class TelegramBot:
    def __init__(self, workflow, client, state, allowed_chat_ids):
        allowed = frozenset(allowed_chat_ids)
        if not allowed or any(type(chat_id) is not int or not 0 < chat_id <= MAX_CHAT_ID for chat_id in allowed):
            raise TelegramError("allowlist")
        self.workflow = workflow
        self.client = client
        self.state = state
        self.allowed_chat_ids = allowed
        self.started = False

    def start(self):
        if self.started:
            return 0
        self.state.acquire_runner()
        try:
            info = self.client.get_webhook_info()
            if not isinstance(info, dict) or not isinstance(info.get("url"), str):
                raise TelegramError("response")
            if info["url"]:
                raise TelegramError("webhook")
            recovered = self.state.recover_pending()
            self.started = True
            return recovered
        except Exception:
            self.state.release_runner()
            raise

    def close(self):
        self.state.release_runner()
        self.started = False

    def _reply(self, message, update_id, chat_id):
        text = message.get("text")
        mode = getattr(getattr(self.workflow, "gateway", None), "mode", "fixture")
        banner = _mode_banner(mode)
        if not isinstance(text, str) or not text.strip():
            return banner + "فعلاً فقط پیام متنی را می‌خوانم. نام خودرو و سال را بنویسید؛ مثلاً «۲۰۷ مدل ۱۴۰۲». عکس، صدا و فایل پردازش نمی‌شوند.", "unsupported_message"
        text = text.strip()
        if re.match(r"^/start(?:@[A-Za-z0-9_]+)?(?:\s|$)", text):
            return banner + "سلام! نام خودرو و سال تولید را بفرستید؛ مثلاً «۲۰۷ مدل ۱۴۰۲». اگر سال مشخص نباشد، می‌پرسم. قیمت و شرایط از جدول نمونه خوانده می‌شوند. نو یا کارکرده بودن در جدول ثبت نشده است.", None
        if len(text) > MAX_INPUT_LENGTH:
            return banner + "پیام خیلی طولانی است. لطفاً نام خودرو و سال را در پیامی کوتاه‌تر از ۲۰۰۰ نویسه بنویسید.", "input_too_long"
        try:
            result = self.workflow.handle(text, chat_id="telegram:" + str(chat_id), request_id="telegram:" + str(update_id))
            if not isinstance(result, dict) or not isinstance(result.get("reply"), str) or not result["reply"].strip():
                raise ValueError()
            reply = _mode_banner(result.get("mode", mode)) + result["reply"]
            if _message_length(reply) > MAX_MESSAGE_LENGTH:
                raise ValueError()
            return reply, None
        except Exception:
            # Do not leak filesystem paths, model errors or input into logs.
            return banner + "ساخت پاسخ کامل نشد. لطفاً کمی بعد دوباره نام خودرو و سال را بفرستید؛ برای بررسی قیمت نمونه، اپراتور می‌تواند جدول را بررسی کند.", "workflow_error"

    def process_update(self, update):
        if not isinstance(update, dict) or not _valid_update_id(update.get("update_id")):
            raise TelegramError("response")
        update_id = update["update_id"]
        if update_id < self.state.offset:
            return {"update_id": update_id, "status": "duplicate"}
        message = update.get("message")
        if not isinstance(message, dict):
            self.state.skip(update_id, "unsupported_update")
            return {"update_id": update_id, "status": "skipped"}
        chat = message.get("chat")
        chat_id = chat.get("id") if isinstance(chat, dict) else None
        sender = message.get("from")
        if (
            not isinstance(chat, dict)
            or chat.get("type") != "private"
            or type(chat_id) is not int
            or chat_id not in self.allowed_chat_ids
            or isinstance(sender, dict) and sender.get("is_bot") is True
        ):
            self.state.skip(update_id, "not_allowed_private_chat")
            return {"update_id": update_id, "status": "skipped"}
        if not self.state.claim(update_id, chat_id):
            return {"update_id": update_id, "status": "duplicate"}
        reply, error_code = self._reply(message, update_id, chat_id)
        self.state.prepare(update_id, reply, error_code)
        try:
            result = self.client.send_message(chat_id, reply)
            # Also validate a supplied client, not only TelegramClient itself.
            if (
                not isinstance(result, dict)
                or type(result.get("message_id")) is not int
                or result["message_id"] <= 0
                or not isinstance(result.get("chat"), dict)
                or type(result["chat"].get("id")) is not int
                or result["chat"]["id"] != chat_id
            ):
                raise TelegramError("response", ambiguous=True)
        except TelegramError as error:
            status = "needs_review" if error.ambiguous else "failed"
            self.state.finish(update_id, status, error.code)
            return {"update_id": update_id, "status": status, "code": error.code}
        except Exception:
            self.state.finish(update_id, "needs_review", "delivery_unknown")
            return {"update_id": update_id, "status": "needs_review", "code": "delivery_unknown"}
        self.state.finish(update_id, "sent", remote_message_id=result["message_id"])
        return {"update_id": update_id, "status": "sent"}

    def poll_once(self, timeout=25):
        self.start()
        updates = self.client.get_updates(self.state.offset, timeout=timeout)
        if not isinstance(updates, list) or any(not isinstance(update, dict) or not _valid_update_id(update.get("update_id")) for update in updates):
            raise TelegramError("response")
        return [self.process_update(update) for update in sorted(updates, key=lambda update: update["update_id"])]

    def run(self):
        recovered = self.start()
        if recovered:
            print(f"{recovered} interrupted update(s) held for review; no automatic resend.", file=sys.stderr)
        failures = 0
        try:
            while True:
                try:
                    results = self.poll_once()
                    failures = 0
                    for result in results:
                        if result["status"] in ("needs_review", "failed"):
                            print("Delivery held for human review; use --review. No automatic resend.", file=sys.stderr)
                except TelegramError as error:
                    if error.code in ("storage", "webhook", "already_running", "configuration"):
                        raise
                    failures += 1
                    print("Telegram polling unavailable (" + error.code + "); retrying read only.", file=sys.stderr)
                    time.sleep(error.retry_after or min(30, 2 ** min(failures, 5)))
        finally:
            self.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="RAVAL optional Telegram test adapter; never starts on import.")
    parser.add_argument("--review", action="store_true", help="Read the local delivery journal; do not contact Telegram or resend.")
    args = parser.parse_args(argv)
    state_path = os.getenv("TELEGRAM_STATE_DB") or DEFAULT_STATE_PATH
    try:
        if args.review:
            print(json.dumps(TelegramState.review_file(state_path), ensure_ascii=False, indent=2))
            return 0
        allowed = parse_allowed_chat_ids(os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", ""))
        client = TelegramClient(os.getenv("TELEGRAM_BOT_TOKEN", "").strip())
        state = TelegramState(state_path, bot_identity=client.bot_identity)
        # Lazy import makes mocked adapter tests independent of the HTTP server.
        from workflow import Workflow
        bot = TelegramBot(Workflow(), client, state, allowed)
        print("RAVAL test bot: explicit private-chat allowlist; sample prices; one send attempt per update.")
        bot.run()
        return 0
    except KeyboardInterrupt:
        return 0
    except TelegramError as error:
        print(str(error), file=sys.stderr)
        return 2
    except (sqlite3.Error, OSError):
        print(str(TelegramError("storage")), file=sys.stderr)
        return 2
    except Exception:
        print(str(TelegramError("configuration")), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
