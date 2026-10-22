"""Telegram adapter tests. Transports are mocked: no external messages sent."""
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from telegram_bot import (  # noqa: E402
    MAX_RESPONSE_BYTES, TelegramBot, TelegramClient, TelegramError, TelegramState,
    _NoRedirect, main, parse_allowed_chat_ids,
)


FAKE_TOKEN = "123456:" + "X" * 30  # Synthetic fixture; never a credential.


def update(update_id=100, chat_id=42, text="۲۰۷ مدل ۱۴۰۲", chat_type="private", **message_extra):
    message = {"message_id": update_id, "chat": {"id": chat_id, "type": chat_type},
               "from": {"id": chat_id, "is_bot": False}}
    if text is not None:
        message["text"] = text
    message.update(message_extra)
    return {"update_id": update_id, "message": message}


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.webhook_url = ""
        self.updates = []
        self.send_result = None
        self.send_observer = None

    def __call__(self, method, payload, timeout):
        self.calls.append((method, payload, timeout))
        if method == "getWebhookInfo":
            return {"ok": True, "result": {"url": self.webhook_url}}
        if method == "getUpdates":
            return {"ok": True, "result": self.updates}
        if method == "sendMessage":
            if self.send_observer:
                self.send_observer(payload)
            if isinstance(self.send_result, Exception):
                raise self.send_result
            if self.send_result is not None:
                return self.send_result
            return {"ok": True, "result": {"message_id": 9000 + len(self.calls), "chat": {"id": payload["chat_id"]}}}
        raise AssertionError("Unexpected method: " + method)

    def sent(self):
        return [call for call in self.calls if call[0] == "sendMessage"]


class TelegramTests(unittest.TestCase):
    def setUp(self):
        self.network_guard = patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Live network forbidden in tests"))
        self.network_guard.start()
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "telegram.sqlite3"
        self.state = TelegramState(self.path, bot_identity="123456")
        self.transport = FakeTransport()
        self.client = TelegramClient(FAKE_TOKEN, transport=self.transport)
        self.workflow = SimpleNamespace(gateway=SimpleNamespace(mode="fixture"), handle=Mock(return_value={
            "reply": "قیمت نمونه: ۹۰۰٬۰۰۰٬۰۰۰ تومان\n<متن> و *علامت* باید ساده بماند.", "mode": "fixture",
        }))
        self.bot = TelegramBot(self.workflow, self.client, self.state, {42, 43})

    def tearDown(self):
        self.bot.close()
        self.temp.cleanup()
        self.network_guard.stop()

    def test_allowlist_is_explicit_positive_private_ids(self):
        self.assertEqual(parse_allowed_chat_ids(" 42,43,42 "), frozenset({42, 43}))
        for value in (None, "", "*", "-10042", "0", "42,", "42 43", "42.0", "true", str(2**52)):
            with self.subTest(value=value), self.assertRaises(TelegramError):
                parse_allowed_chat_ids(value)
        with self.assertRaises(TelegramError):
            TelegramBot(self.workflow, self.client, self.state, {True})

    def test_missing_configuration_stops_without_any_call(self):
        with patch.dict(os.environ, {}, clear=True), patch("sys.stderr", new_callable=io.StringIO):
            self.assertEqual(main([]), 2)
        self.assertEqual(self.transport.calls, [])
        for token in ("", "abc", "123:" + "X" * 30 + "\n", FAKE_TOKEN + "/redirect"):
            with self.subTest(token_len=len(token)), self.assertRaises(TelegramError) as caught:
                TelegramClient(token)
            self.assertNotIn(token or "NEVER", str(caught.exception))
        self.assertNotIn(FAKE_TOKEN, repr(self.client))

    def test_active_webhook_refused_without_deleting_or_polling(self):
        self.transport.webhook_url = "https://private.example/secret-webhook"
        with self.assertRaises(TelegramError) as caught:
            self.bot.start()
        self.assertEqual(caught.exception.code, "webhook")
        self.assertNotIn("secret-webhook", str(caught.exception))
        self.assertEqual([call[0] for call in self.transport.calls], ["getWebhookInfo"])
        self.assertFalse(self.bot.started)
        self.assertIsNone(self.state._runner_lock)

    def test_start_checks_webhook_only_once_and_then_long_polls(self):
        self.bot.poll_once()
        self.bot.poll_once()
        self.assertEqual([call[0] for call in self.transport.calls], ["getWebhookInfo", "getUpdates", "getUpdates"])
        _, payload, timeout = self.transport.calls[1]
        self.assertEqual(payload, {"offset": 0, "timeout": 25, "limit": 100, "allowed_updates": ["message"]})
        self.assertEqual(timeout, 35)

    def test_send_is_plaintext_and_journal_is_durable_before_attempt(self):
        def inspect_pending(payload):
            row = TelegramState(self.path).get(100)
            self.assertEqual(row["status"], "pending")
            self.assertEqual(row["reply"], payload["text"])
            self.assertEqual(self.state.offset, 0)
        self.transport.send_observer = inspect_pending
        result = self.bot.process_update(update())
        self.assertEqual(result["status"], "sent")
        self.workflow.handle.assert_called_once_with("۲۰۷ مدل ۱۴۰۲", chat_id="telegram:42", request_id="telegram:100")
        payload = self.transport.sent()[0][1]
        self.assertNotIn("parse_mode", payload)
        self.assertEqual(payload["link_preview_options"], {"is_disabled": True})
        self.assertIn("<متن> و *علامت*", payload["text"])
        self.assertIn("بدون تماس با مدل زنده", payload["text"])
        self.assertIn("قیمت‌های نمونه", payload["text"])
        self.assertEqual(self.state.get(100)["status"], "sent")
        self.assertGreater(self.state.get(100)["remote_message_id"], 0)
        self.assertEqual(self.state.offset, 101)

    def test_duplicate_update_and_restart_never_send_twice(self):
        self.bot.process_update(update())
        self.assertEqual(self.bot.process_update(update())["status"], "duplicate")
        restarted = TelegramBot(self.workflow, self.client, TelegramState(self.path, "123456"), {42})
        try:
            restarted.start()
            self.assertEqual(restarted.process_update(update())["status"], "duplicate")
        finally:
            restarted.close()
        self.assertEqual(len(self.transport.sent()), 1)
        self.assertEqual(self.workflow.handle.call_count, 1)

    def test_separate_chats_have_separate_workflow_context_ids(self):
        self.bot.process_update(update(100, 42))
        self.bot.process_update(update(101, 43, "۱۴۰۲"))
        self.assertEqual([call.kwargs["chat_id"] for call in self.workflow.handle.call_args_list], ["telegram:42", "telegram:43"])
        self.assertEqual([call.kwargs["request_id"] for call in self.workflow.handle.call_args_list], ["telegram:100", "telegram:101"])

    def test_group_unauthorized_bot_and_edited_updates_are_skipped(self):
        cases = [update(100, 999), update(101, 42, chat_type="group"),
                 update(102, 42, chat_type="channel"),
                 update(103, 42, **{"from": {"id": 42, "is_bot": True}}),
                 {"update_id": 104, "edited_message": update()["message"]},
                 {"update_id": 105, "callback_query": {"data": "ignored"}}]
        for value in cases:
            self.assertEqual(self.bot.process_update(value)["status"], "skipped")
            self.assertIsNone(self.state.get(value["update_id"])["chat_id"])
        self.assertEqual(self.transport.sent(), [])
        self.workflow.handle.assert_not_called()
        self.assertEqual(self.state.offset, 106)

    def test_start_and_unsupported_media_give_useful_instructions(self):
        self.bot.process_update(update(100, text="/start@ExampleTestBot welcome"))
        self.bot.process_update(update(101, text=None, photo=[{"file_id": "unused"}]))
        self.workflow.handle.assert_not_called()
        self.assertIn("نام خودرو و سال", self.transport.sent()[0][1]["text"])
        self.assertIn("فقط پیام متنی", self.transport.sent()[1][1]["text"])
        self.assertIn("عکس، صدا و فایل پردازش نمی‌شوند", self.transport.sent()[1][1]["text"])
        self.assertEqual(self.state.get(101)["error_code"], "unsupported_message")

    def test_oversized_input_and_workflow_failure_do_not_leak_details(self):
        self.bot.process_update(update(100, text="الف" * 700))
        self.workflow.handle.assert_not_called()
        self.assertIn("۲۰۰۰", self.transport.sent()[0][1]["text"])
        self.workflow.handle.side_effect = RuntimeError("secret " + FAKE_TOKEN)
        self.bot.process_update(update(101))
        self.assertIn("ساخت پاسخ کامل نشد", self.transport.sent()[1][1]["text"])
        self.assertNotIn(FAKE_TOKEN, self.transport.sent()[1][1]["text"])
        self.assertEqual(self.state.get(101)["error_code"], "workflow_error")

    def test_live_and_fallback_modes_are_disclosed_in_outbound_text(self):
        for index, (mode, expected) in enumerate((("live", "مدل زنده برای استخراج"), ("fallback", "قواعد جایگزین محلی"))):
            self.workflow.handle.return_value = {"reply": "پاسخ نمونه", "mode": mode}
            self.bot.process_update(update(100 + index))
            self.assertIn(expected, self.transport.sent()[-1][1]["text"])
            self.assertIn("قیمت‌های نمونه", self.transport.sent()[-1][1]["text"])

    def test_poll_sorts_batch_and_persists_next_offset(self):
        self.transport.updates = [update(102), update(100), update(101)]
        self.assertEqual([item["update_id"] for item in self.bot.poll_once()], [100, 101, 102])
        self.assertEqual(self.state.offset, 103)
        self.transport.updates = []
        self.bot.poll_once(timeout=12)
        last_poll = [call for call in self.transport.calls if call[0] == "getUpdates"][-1]
        self.assertEqual(last_poll[1]["offset"], 103)
        self.assertEqual(last_poll[1]["timeout"], 12)
        self.assertEqual(last_poll[2], 22)

    def test_malformed_poll_batch_is_rejected_before_processing(self):
        self.transport.updates = [update(100), {"update_id": True}]
        with self.assertRaises(TelegramError):
            self.bot.poll_once()
        self.assertEqual(self.state.offset, 0)
        self.assertEqual(self.transport.sent(), [])
        self.workflow.handle.assert_not_called()

    def test_ambiguous_send_timeout_is_reviewed_and_never_retried(self):
        self.transport.send_result = socket.timeout("https://api.telegram.org/bot" + FAKE_TOKEN + "/sendMessage")
        result = self.bot.process_update(update())
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(self.state.offset, 101)
        self.assertEqual(self.state.get(100)["status"], "needs_review")
        self.assertEqual(self.bot.process_update(update())["status"], "duplicate")
        self.bot.start()
        self.bot.close()
        restarted = TelegramBot(self.workflow, self.client, TelegramState(self.path), {42})
        try:
            restarted.start()
            self.assertEqual(restarted.process_update(update())["status"], "duplicate")
        finally:
            restarted.close()
        self.assertEqual(len(self.transport.sent()), 1)
        self.assertNotIn(FAKE_TOKEN, json.dumps(self.state.review()))

    def test_server_error_or_unverifiable_acknowledgement_is_held(self):
        cases = [
            {"ok": False, "error_code": 500, "description": "secret " + FAKE_TOKEN},
            {"ok": True, "result": {}},
            {"ok": True, "result": {"message_id": 9, "chat": {"id": 999}}},
            {"ok": True, "result": {"message_id": True, "chat": {"id": 42}}},
            {"ok": "true", "result": {}},
            {"ok": False, "description": "missing error code"},
        ]
        for index, value in enumerate(cases):
            with self.subTest(index=index):
                self.transport.send_result = value
                result = self.bot.process_update(update(100 + index))
                self.assertEqual(result["status"], "needs_review")
                self.assertEqual(self.state.get(100 + index)["status"], "needs_review")
        self.assertEqual(len(self.transport.sent()), len(cases))

    def test_explicit_rejection_is_failed_and_requires_human_action(self):
        for index, code in enumerate((400, 403, 429)):
            self.transport.send_result = {"ok": False, "error_code": code, "description": FAKE_TOKEN,
                                          "parameters": {"retry_after": 10}}
            result = self.bot.process_update(update(100 + index))
            self.assertEqual(result["status"], "failed")
            self.assertEqual(self.bot.process_update(update(100 + index))["status"], "duplicate")
        self.assertEqual(len(self.transport.sent()), 3)
        self.assertEqual(self.state.offset, 103)
        self.assertEqual(len(self.state.review()), 3)

    def test_restart_quarantines_processing_and_pending_without_send(self):
        self.assertTrue(self.state.claim(100, 42))
        self.assertTrue(self.state.claim(101, 42))
        self.state.prepare(101, "ممکن است قبلاً ارسال شده باشد")
        self.assertEqual(self.bot.start(), 2)
        for update_id in (100, 101):
            self.assertEqual(self.state.get(update_id)["status"], "needs_review")
            self.assertEqual(self.state.get(update_id)["error_code"], "interrupted")
            self.assertEqual(self.bot.process_update(update(update_id))["status"], "duplicate")
        self.assertEqual(self.state.offset, 102)
        self.assertEqual(self.transport.sent(), [])

    def test_crash_after_send_before_commit_does_not_send_again(self):
        with patch.object(self.state, "finish", side_effect=sqlite3.OperationalError("simulated disk failure")):
            with self.assertRaises(sqlite3.OperationalError):
                self.bot.process_update(update())
        self.assertEqual(len(self.transport.sent()), 1)
        self.assertEqual(self.state.get(100)["status"], "pending")
        self.assertEqual(self.bot.start(), 1)
        self.assertEqual(self.state.get(100)["status"], "needs_review")
        self.assertEqual(self.bot.process_update(update())["status"], "duplicate")
        self.assertEqual(len(self.transport.sent()), 1)

    def test_journal_write_failure_prevents_unrecorded_send(self):
        with patch.object(self.state, "prepare", side_effect=sqlite3.OperationalError("simulated disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.bot.process_update(update())
        self.assertEqual(self.transport.sent(), [])
        self.assertEqual(self.state.get(100)["status"], "processing")
        self.bot.start()
        self.assertEqual(self.state.get(100)["status"], "needs_review")

    def test_only_one_runner_can_recover_or_poll_same_journal(self):
        self.bot.start()
        another_state = TelegramState(self.path)
        another_transport = FakeTransport()
        another = TelegramBot(self.workflow, TelegramClient(FAKE_TOKEN, another_transport), another_state, {42})
        try:
            with self.assertRaises(TelegramError) as caught:
                another.start()
            self.assertEqual(caught.exception.code, "already_running")
            self.assertEqual(another_transport.calls, [])
            self.bot.close()
            another.start()
            self.assertTrue(another.started)
        finally:
            another.close()

    def test_state_cannot_be_reused_for_different_bot_identity(self):
        with self.assertRaises(TelegramError) as caught:
            TelegramState(self.path, "987654")
        self.assertEqual(caught.exception.code, "wrong_bot")
        self.assertEqual(self.state.offset, 0)

    def test_review_is_read_only_and_needs_no_credentials(self):
        self.transport.send_result = TimeoutError("unknown delivery")
        self.bot.process_update(update())
        before = self.path.read_bytes()
        with patch.dict(os.environ, {"TELEGRAM_STATE_DB": str(self.path)}, clear=True), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(main(["--review"]), 0)
        entries = json.loads(output.getvalue())
        self.assertEqual(entries[0]["status"], "needs_review")
        self.assertEqual(before, self.path.read_bytes())
        absent = Path(self.temp.name) / "not-created.sqlite3"
        self.assertEqual(TelegramState.review_file(absent), [])
        self.assertFalse(absent.exists())
        self.assertEqual(len(self.transport.sent()), 1)

    def test_unknown_large_or_empty_workflow_reply_is_not_truncated_invoice(self):
        for index, bad in enumerate(({"reply": "x" * 4096}, {"reply": ""}, {"reply": None}, [])):
            self.workflow.handle.return_value = bad
            result = self.bot.process_update(update(100 + index))
            self.assertEqual(result["status"], "sent")
            self.assertIn("ساخت پاسخ کامل نشد", self.transport.sent()[-1][1]["text"])
            self.assertEqual(self.state.get(100 + index)["error_code"], "workflow_error")

    def test_invalid_update_or_message_bounds_fail_before_transport(self):
        for value in ({}, {"update_id": True}, {"update_id": -1}, {"update_id": 2**63}):
            with self.subTest(value=value), self.assertRaises(TelegramError):
                self.bot.process_update(value)
        for chat_id, text in ((True, "a"), (-42, "a"), (42, ""), (42, "😀" * 2049), (42, "\ud800")):
            with self.subTest(chat_id=chat_id, text_len=len(text)), self.assertRaises(TelegramError):
                self.client.send_message(chat_id, text)
        self.assertEqual(self.transport.calls, [])

    def test_http_failures_are_secret_safe_and_ambiguous_sends_are_marked(self):
        client = TelegramClient(FAKE_TOKEN)
        for exception, uncertain in (
            (socket.timeout(FAKE_TOKEN), True),
            (URLError(FAKE_TOKEN), True),
            (HTTPError("https://api.telegram.org/bot" + FAKE_TOKEN, 500, FAKE_TOKEN, {}, io.BytesIO()), True),
            (HTTPError("https://api.telegram.org/bot" + FAKE_TOKEN, 400, FAKE_TOKEN, {}, io.BytesIO()), False),
        ):
            with self.subTest(kind=type(exception).__name__, uncertain=uncertain):
                opener = Mock()
                opener.open.side_effect = exception
                with patch("telegram_bot.build_opener", return_value=opener):
                    try:
                        client.send_message(42, "سلام")
                    except TelegramError as error:
                        self.assertEqual(error.ambiguous, uncertain)
                        self.assertNotIn(FAKE_TOKEN, traceback.format_exc())
                    else:
                        self.fail("Expected safe transport error")

    def test_http_response_limit_and_redirects_are_enforced(self):
        client = TelegramClient(FAKE_TOKEN)
        for raw in (b"x" * (MAX_RESPONSE_BYTES + 1), b"<html>error</html>", b'{"ok":true,"ok":false}'):
            stream = Mock()
            stream.__enter__ = Mock(return_value=stream)
            stream.__exit__ = Mock(return_value=False)
            stream.read.return_value = raw
            opener = Mock()
            opener.open.return_value = stream
            with self.subTest(length=len(raw)), patch("telegram_bot.build_opener", return_value=opener) as factory:
                with self.assertRaises(TelegramError) as caught:
                    client.send_message(42, "سلام")
                self.assertTrue(caught.exception.ambiguous)
                self.assertIsInstance(factory.call_args.args[0], _NoRedirect)
                self.assertIsNone(factory.call_args.args[0].redirect_request(None, None, 302, None, None, "https://evil.invalid"))
                stream.read.assert_called_once_with(MAX_RESPONSE_BYTES + 1)


if __name__ == "__main__":
    unittest.main()
