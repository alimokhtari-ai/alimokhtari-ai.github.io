"""Real local HTTP contract checks with an isolated temporary CSV/database."""
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest

from server import WorkbenchServer
from workflow import Workflow
from test_workflow import FixtureGateway

ROOT = Path(__file__).resolve().parents[1]


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.csv = Path(self.tmp.name) / "prices.csv"
        shutil.copyfile(ROOT / "data/prices.csv", self.csv)
        self.flow = Workflow(self.csv, Path(self.tmp.name) / "state.sqlite3", FixtureGateway())
        self.server = WorkbenchServer(("127.0.0.1", 0), self.flow)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, payload=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        actual = dict(headers or {})
        body = raw
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            actual.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=body, headers=actual)
        response = conn.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), data)
        conn.close()
        return result

    def json(self, method, path, payload=None, headers=None):
        status, response_headers, data = self.request(method, path, payload, headers)
        return status, json.loads(data)

    def test_real_quote_ambiguity_followup_and_history(self):
        status, first = self.json("POST", "/api/message", {"text": "۲۰۷ نو چند؟", "chat_id": "http", "request_id": "a"})
        self.assertEqual(status, 200)
        self.assertEqual(first["status"], "clarify")
        self.assertIsNone(first["quote"])
        status, result = self.json("POST", "/api/message", {"text": "۱۴۰۲", "chat_id": "http", "request_id": "b"})
        self.assertEqual(result["quote"]["price_toman"], "1090000000")
        self.assertEqual(len(result["trace"]), 6)
        self.assertTrue(all(isinstance(stage["elapsed_ms"], (int, float)) for stage in result["trace"]))
        status, history = self.json("GET", "/api/history?chat_id=http")
        self.assertEqual(len(history["history"]), 2)

    def test_exact_irregular_price_editor_updates_actual_csv(self):
        _, before = self.json("GET", "/api/catalog")
        before["rows"][1]["price_toman"] = "1090000123"
        status, updated = self.json("POST", "/api/catalog", {"rows": before["rows"], "expected_version": before["version"]})
        self.assertEqual(status, 200)
        self.assertNotEqual(updated["version"], before["version"])
        self.assertIn("1090000123", self.csv.read_text(encoding="utf-8-sig"))
        _, quote = self.json("POST", "/api/message", {"text": "۲۰۷ مدل ۱۴۰۲"})
        self.assertEqual(quote["quote"]["price_toman"], "1090000123")
        status, _, exported = self.request("GET", "/api/catalog.csv")
        self.assertEqual(status, 200)
        self.assertEqual(exported[:3], b"\xef\xbb\xbf")
        self.assertIn("1090000123", exported.decode("utf-8-sig"))

    def test_invalid_and_duplicate_edits_never_replace_source(self):
        original = self.csv.read_bytes()
        _, catalog = self.json("GET", "/api/catalog")
        cases = [[], catalog["rows"] + [catalog["rows"][0]], [{**catalog["rows"][0], "price_toman": "1e9"}], [{**catalog["rows"][0], "model": "=CMD()"}]]
        for rows in cases:
            status, _ = self.json("POST", "/api/catalog", {"rows": rows, "expected_version": catalog["version"]})
            self.assertEqual(status, 400)
            self.assertEqual(self.csv.read_bytes(), original)
        self.assertEqual(list(self.csv.parent.glob(".prices-*")), [])

    def test_stale_editor_version_and_request_reuse_conflict(self):
        _, before = self.json("GET", "/api/catalog")
        payload = {"rows": before["rows"], "expected_version": before["version"]}
        self.assertEqual(self.json("POST", "/api/catalog", payload)[0], 200)
        self.assertEqual(self.json("POST", "/api/catalog", payload)[0], 409)
        self.json("POST", "/api/message", {"text": "۲۰۷ ۱۴۰۲", "request_id": "duplicate"})
        self.assertEqual(self.json("POST", "/api/message", {"text": "شاهین ۱۴۰۲", "request_id": "duplicate"})[0], 409)

    def test_origin_host_and_content_type_guards(self):
        self.assertEqual(self.json("POST", "/api/reset", {}, {"Origin": "https://external.example"})[0], 403)
        self.assertEqual(self.json("POST", "/api/reset", {}, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.json("POST", "/api/reset", {}, {"Host": f"evil.example:{self.port}"})[0], 403)
        self.assertEqual(self.request("POST", "/api/reset", raw=b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/reset", raw=b"{" + b"x" * 65536, headers={"Content-Type": "application/json"})[0], 413)
        self.assertEqual(self.json("POST", "/api/reset", {}, {"Origin": f"http://127.0.0.1:{self.port}"})[0], 200)

    def test_static_paths_and_headers_keep_private_source_private(self):
        status, headers, html = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn('lang="fa" dir="rtl"', html.decode())
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        for path in ["/../workflow.py", "/%2e%2e/workflow.py", "/.env", "/api/unknown"]:
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_invalid_source_returns_no_financial_quote(self):
        self.csv.write_text("broken", encoding="utf-8")
        self.assertEqual(self.json("GET", "/api/catalog")[0], 503)
        status, response = self.json("POST", "/api/message", {"text": "۲۰۷ ۱۴۰۲"})
        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "blocked")
        self.assertIsNone(response["quote"])


if __name__ == "__main__":
    unittest.main()
