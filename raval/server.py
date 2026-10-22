"""Local-only RAVAL workbench. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import csv
import io
import json
import mimetypes
import os
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit, unquote
import webbrowser

from quote_engine import QuoteEngine, CatalogError
from workflow import Workflow, RequestValidationError, DuplicateRequestError, BASE_DIR

MAX_BODY = 64 * 1024
CSV_HEADERS = ["خودرو", "سال", "قیمت", "درصد پیش‌پرداخت", "تعداد اقساط"]


class CatalogConflict(ValueError):
    pass


def replace_catalog(workflow, rows, expected_version):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise RequestValidationError("جدول باید بین ۱ تا ۲۰۰ ردیف داشته باشد.")
    if not isinstance(expected_version, str) or not expected_version:
        raise RequestValidationError("نسخهٔ جدول را دوباره دریافت کنید.")
    fields = ["model", "year", "price_toman", "down_payment_percent", "installments"]
    with workflow.lock:
        if workflow.engine.catalog()["version"] != expected_version:
            raise CatalogConflict("جدول در این فاصله تغییر کرده است. جدول تازه را بارگیری کنید و دوباره تغییر دهید.")
        source = workflow.csv_path
        fd, temp_name = tempfile.mkstemp(prefix=".prices-", suffix=".csv", dir=source.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.writer(stream, lineterminator="\r\n")
                writer.writerow(CSV_HEADERS)
                for row in rows:
                    if not isinstance(row, dict) or any(field not in row for field in fields):
                        raise RequestValidationError("هر ردیف باید خودرو، سال، قیمت و شرایط اقساط کامل داشته باشد.")
                    values = [row[field] for field in fields]
                    if any(isinstance(value, (dict, list, bool)) or value is None for value in values):
                        raise RequestValidationError("مقدار نامعتبر در جدول قیمت.")
                    if any(len(str(value)) > 100 for value in values):
                        raise RequestValidationError("یکی از مقدارهای جدول بیش از حد طولانی است.")
                    writer.writerow(values)
                stream.flush()
                os.fsync(stream.fileno())
            QuoteEngine(temp_name, annual_rate=workflow.annual_rate).catalog()
            os.replace(temp_name, source)
            return workflow.engine.catalog()
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workflow=None):
        self.workflow = workflow or Workflow()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "RavalLocal/1.0"

    def log_message(self, fmt, *args):
        # Do not write customer queries, provider errors, tokens or POST bodies.
        pass

    def _headers(self, code, content_type, length, filename=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()

    def _bytes(self, body, kind, code=200, filename=None):
        self._headers(code, kind, len(body), filename)
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, body, code=200):
        self._bytes(json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8"), "application/json; charset=utf-8", code)

    def _host_allowed(self):
        # A loopback bind alone does not prevent DNS rebinding.
        authority = self.headers.get("Host", "")
        try:
            parsed = urlsplit("http://" + authority)
            return parsed.hostname in ("localhost", "127.0.0.1") and parsed.port == self.server.server_port and not parsed.username
        except ValueError:
            return False

    def _same_origin(self):
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                if parsed.scheme != "http" or parsed.netloc != self.headers.get("Host") or parsed.path or parsed.query or parsed.fragment:
                    return False
            except ValueError:
                return False
        site = self.headers.get("Sec-Fetch-Site")
        return site not in ("cross-site", "same-site")

    def do_GET(self):
        if not self._host_allowed():
            self._json({"error": "این سرویس فقط از نشانی محلی خودش در دسترس است."}, 403)
            return
        try:
            path = urlsplit(self.path).path
            workflow = self.server.workflow
            if path == "/api/config":
                catalog = workflow.engine.catalog()
                self._json({"product": "روال", "mode": workflow.gateway.mode,
                            "label": workflow.gateway.label, "timezone": "Asia/Tehran",
                            "rate": str(workflow.annual_rate), "context_minutes": 15,
                            "source": {"name": "prices.csv", "version": catalog["version"], "rows": len(catalog["rows"])},
                            "telegram": "simulator"})
            elif path == "/api/catalog":
                self._json(workflow.engine.catalog())
            elif path == "/api/history":
                chat_id = parse_qs(urlsplit(self.path).query).get("chat_id", ["demo"])[0]
                self._json({"history": workflow.history(chat_id)})
            elif path == "/api/catalog.csv":
                workflow.engine.catalog()  # refuse exporting invalid source
                raw = workflow.csv_path.read_bytes()
                if not raw.startswith(b"\xef\xbb\xbf"):
                    raw = b"\xef\xbb\xbf" + raw
                self._bytes(raw, "text/csv; charset=utf-8", filename="RAVAL-prices.csv")
            elif path == "/api/workflow.json":
                self._bytes((BASE_DIR / "workflow.json").read_bytes(), "application/json; charset=utf-8", filename="RAVAL-workflow.json")
            elif path.startswith("/api/"):
                self._json({"error": "این مسیر وجود ندارد."}, 404)
            else:
                root = (BASE_DIR / "web").resolve()
                relative = "index.html" if path == "/" else unquote(path).lstrip("/")
                local = (root / relative).resolve()
                if not local.is_relative_to(root) or not local.is_file():
                    self._json({"error": "فایل پیدا نشد."}, 404)
                    return
                kind = mimetypes.guess_type(local.name)[0] or "application/octet-stream"
                if kind.startswith("text/") or kind in ("application/javascript", "application/json"):
                    kind += "; charset=utf-8"
                self._bytes(local.read_bytes(), kind)
        except CatalogError:
            self._json({"error": "جدول قیمت نامعتبر یا در دسترس نیست؛ صدور پیش‌فاکتور متوقف شده است."}, 503)
        except (RequestValidationError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)
        except (OSError, RuntimeError):
            self._json({"error": "سرویس محلی نتوانست این درخواست را کامل کند؛ فایل‌ها و دسترسی نوشتن را بررسی کنید."}, 503)

    def do_POST(self):
        if not self._host_allowed() or not self._same_origin():
            self._json({"error": "درخواست باید از همین صفحهٔ محلی ارسال شود."}, 403)
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            self._json({"error": "بدنهٔ درخواست باید JSON باشد."}, 415)
            return
        try:
            if self.headers.get("Transfer-Encoding"):
                raise RequestValidationError("نوع ارسال پشتیبانی نمی‌شود.")
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self._json({"error": "اندازهٔ درخواست معتبر نیست."}, 413)
                return
            self.connection.settimeout(15)
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise RequestValidationError("بدنهٔ درخواست باید یک شیء JSON باشد.")
            path = urlsplit(self.path).path
            workflow = self.server.workflow
            if path == "/api/message":
                self._json(workflow.handle(body.get("text"), body.get("chat_id", "demo"), body.get("request_id")))
            elif path == "/api/reset":
                self._json(workflow.reset(body.get("chat_id", "demo")))
            elif path == "/api/catalog":
                self._json(replace_catalog(workflow, body.get("rows"), body.get("expected_version")))
            else:
                self._json({"error": "این مسیر وجود ندارد."}, 404)
        except (CatalogConflict, DuplicateRequestError) as exc:
            self._json({"error": str(exc)}, 409)
        except CatalogError as exc:
            self._json({"error": "جدول ذخیره نشد؛ مقدارها، ردیف‌های تکراری و عددهای معتبر را بررسی کنید."}, 400)
        except (RequestValidationError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            message = str(exc) if isinstance(exc, RequestValidationError) else "دادهٔ درخواست معتبر نیست."
            self._json({"error": message}, 400)
        except (OSError, RuntimeError):
            self._json({"error": "درخواست کامل نشد. ارتباط با سرویس محلی و دسترسی فایل‌ها را بررسی کنید."}, 503)


def main():
    parser = argparse.ArgumentParser(description="RAVAL local quotation workbench")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the local workbench in your browser")
    args = parser.parse_args()
    server = WorkbenchServer(("127.0.0.1", args.port))
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"RAVAL: {url}\nMode: {server.workflow.gateway.mode}\nTimezone: Asia/Tehran\nCtrl+C to stop.")
    if args.open:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
