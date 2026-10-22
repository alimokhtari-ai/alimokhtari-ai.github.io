"""Integration tests for durable context and idempotency; no external API calls."""
import concurrent.futures
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from workflow import Workflow, DuplicateRequestError, RequestValidationError, CONTEXT_TTL_SECONDS

ROOT = Path(__file__).resolve().parents[1]


class FixtureGateway:
    mode = "fixture"
    label = "test fixture"

    def extract(self, text, allowed_models, context):
        return None

    def phrase(self, status):
        return {"opening_id": "hello", "closing_id": "review"}


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.csv = Path(self.tmp.name) / "prices.csv"
        shutil.copyfile(ROOT / "data/prices.csv", self.csv)
        self.db = Path(self.tmp.name) / "state.sqlite3"
        self.env = patch.dict(os.environ, {"QUOTE_ANNUAL_RATE": "23"})
        self.env.start()
        self.flow = Workflow(self.csv, self.db, FixtureGateway())

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_context_survives_process_restart_and_is_scoped_to_chat(self):
        self.assertEqual(self.flow.handle("۲۰۷ نو چند؟", "alice")["status"], "clarify")
        restarted = Workflow(self.csv, self.db, FixtureGateway())
        bob = restarted.handle("۱۴۰۲", "bob")
        self.assertIsNone(bob["quote"])
        alice = restarted.handle("۱۴۰۲", "alice")
        self.assertEqual(alice["quote"]["price_toman"], "1090000000")
        self.assertIn("نو", alice["quote"]["condition_note"])
        self.assertTrue(alice["timestamp"].endswith("+03:30"))

    def test_expired_context_does_not_supply_a_model(self):
        self.flow.handle("۲۰۷ چنده؟", "alice")
        with sqlite3.connect(self.db) as conn:
            conn.execute("UPDATE contexts SET updated_at=updated_at-?", (CONTEXT_TTL_SECONDS + 1,))
        self.assertIsNone(self.flow.handle("۱۴۰۲", "alice")["quote"])

    def test_repeated_request_is_cached_and_different_text_conflicts(self):
        first = self.flow.handle("۲۰۷ مدل ۱۴۰۲", "alice", "req-1")
        second = self.flow.handle("۲۰۷ مدل ۱۴۰۲", "alice", "req-1")
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(first["quote"], second["quote"])
        self.assertEqual(len(self.flow.history("alice")), 1)
        with self.assertRaises(DuplicateRequestError):
            self.flow.handle("شاهین مدل ۱۴۰۲", "alice", "req-1")

    def test_concurrent_identical_requests_execute_once(self):
        with patch.object(self.flow.engine, "process", wraps=self.flow.engine.process) as process:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: self.flow.handle("تارا اتوماتیک ۱۴۰۲", "alice", "concurrent"), range(4)))
        self.assertEqual(process.call_count, 1)
        self.assertEqual(sum(not result["cached"] for result in results), 1)

    def test_new_requests_read_new_source_and_cached_ones_keep_original_provenance(self):
        first = self.flow.handle("۲۰۷ مدل ۱۴۰۲", "alice", "old")
        self.csv.write_text(self.csv.read_text(encoding="utf-8-sig").replace("۱۰۹۰۰۰۰۰۰۰", "۱۰۹۰۰۰۰۱۲۳"), encoding="utf-8-sig")
        updated = self.flow.handle("۲۰۷ مدل ۱۴۰۲", "alice", "new")
        cached = self.flow.handle("۲۰۷ مدل ۱۴۰۲", "alice", "old")
        self.assertEqual(updated["quote"]["price_toman"], "1090000123")
        self.assertNotEqual(first["source"]["version"], updated["source"]["version"])
        self.assertEqual(cached["quote"]["price_toman"], "1090000000")

    def test_reset_affects_only_chosen_conversation(self):
        self.flow.handle("۲۰۷ چنده؟", "alice")
        self.flow.handle("شاهین ۱۴۰۲", "bob")
        self.flow.reset("alice")
        self.assertEqual(self.flow.history("alice"), [])
        self.assertEqual(len(self.flow.history("bob")), 1)
        self.assertIsNone(self.flow.handle("۱۴۰۲", "alice")["quote"])

    def test_invalid_inputs_never_create_history(self):
        for text in ["", "  ", None, 1, "x" * 2001]:
            with self.assertRaises(RequestValidationError):
                self.flow.handle(text)
        for identity in ["../path", "a b", "", None, "x" * 101]:
            with self.assertRaises(RequestValidationError):
                self.flow.handle("سلام", chat_id=identity)
        self.assertEqual(self.flow.history("demo"), [])


if __name__ == "__main__":
    unittest.main()
