"""RAVAL quotation engine: grounded slots, CSV provenance, exact Decimal ledger.

No network, model SDK or external service is required. The optional gateway may
extract only model/year/condition and select two approved phrase identifiers.
It is never a source for price, lending terms or customer-facing financial prose.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import time
import unicodedata
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from pathlib import Path
from typing import Any


HEADERS = ["خودرو", "سال", "قیمت", "درصد پیش‌پرداخت", "تعداد اقساط"]
STAGES = [
    ("intake", "دریافت پیام"),
    ("extraction", "فهم درخواست"),
    ("lookup", "جست‌وجو در CSV"),
    ("calculation", "محاسبهٔ اقساط"),
    ("composition", "ساخت پاسخ"),
    ("validation", "کنترل نهایی"),
]
OPENINGS = {"hello": "سلام،", "formal": "با سلام،"}
CLOSINGS = {
    "review": "این پیش‌فاکتور بر پایهٔ داده‌های نمونه است؛ قبل از هر پرداخت، شرایط و مشخصات خودرو باید توسط فروشنده تأیید شود.",
    "help": "برای ادامه، مدل و سال دقیق خودرو را مشخص کن؛ تأیید نهایی شرایط با فروشنده است.",
}
CONDITIONS = {"نو", "کارکرده"}
MAX_PRICE = 10**24
MAX_ROWS = 1000
MAX_INSTALLMENTS = 1200
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_PERSIAN = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
_MODEL_CHARS = re.compile(r"^[\w\s\-+()]+$", re.UNICODE)
_CONDITION_PATTERNS = {
    "نو": [r"نو", r"صفر(?:\s+کیلومتر)?", r"کار\s*نکرده", r"new"],
    "کارکرده": [r"کار\s*کرده", r"دست\s*دوم", r"used"],
}
_COMMON_MODELS = [
    "پژو پارس", "تارا اتوماتیک", "دنا پلاس", "پژو 206", "پژو 405", "تندر 90",
    "پراید", "تیبا", "ساینا", "سمند", "سورن", "رانا", "کوییک", "کوئیک",
    "شاهین", "تارا", "دنا", "ساندرو", "فیدلیتی", "دیگنیتی", "بوگاتی",
    "تویوتا", "هیوندای", "بنز", "کیا", "207", "206", "405", "ال 90",
]


class CatalogError(ValueError):
    """The entire price source is rejected; no partial catalog is usable."""


class CalculationError(ValueError):
    """The financial configuration cannot produce the promised integer ledger."""


def _latin(value: Any) -> str:
    return str(value).translate(_DIGITS)


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKC", _latin(value))
    text = text.replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ")
    text = re.sub(r"[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]", "", text)
    text = re.sub(r"(?<=\d)(?=[^\W\d_])|(?<=[^\W\d_])(?=\d)", " ", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def _fa(value: Any, grouped: bool = False) -> str:
    text = format(int(value), ",") if grouped else str(value)
    return text.replace(",", "٬").translate(_PERSIAN)


def _decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _integer(value: str, label: str, minimum: int, maximum: int) -> int:
    text = _latin(value).strip()
    if not re.fullmatch(r"\d+|\d{1,3}(?:[,٬]\d{3})+", text):
        raise CatalogError(f"{label} باید عدد صحیح معتبر باشد.")
    number = int(text.replace(",", "").replace("٬", ""))
    if not minimum <= number <= maximum:
        raise CatalogError(f"{label} خارج از محدودهٔ قابل قبول است.")
    return number


def _rate(value: Any, label: str, maximum: Decimal) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{label} معتبر نیست.")
    text = _latin(value).strip().replace("٫", ".")
    if not re.fullmatch(r"\d+(?:\.\d{1,6})?", text):
        raise ValueError(f"{label} باید عدد نامنفی معتبر باشد.")
    try:
        number = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"{label} معتبر نیست.") from exc
    if not number.is_finite() or number > maximum:
        raise ValueError(f"{label} خارج از محدودهٔ قابل قبول است.")
    return number


def _matches(text: str, alias: str) -> bool:
    pattern = r"(?<!\w)" + r"\s*".join(re.escape(v) for v in _norm(alias).split()) + r"(?!\w)"
    return bool(re.search(pattern, text))


def _aliases(model: str) -> set[str]:
    norm = _norm(model)
    aliases = {norm}
    if norm.startswith("پژو "):
        aliases.add(norm.removeprefix("پژو "))
        aliases.add(norm.replace("پژو", "peugeot", 1))
    if "اتوماتیک" in norm:
        aliases.add(norm.replace("اتوماتیک", "اتومات"))
    if "پلاس" in norm:
        aliases.add(norm.replace("پلاس", "+"))
    if "کوییک" in norm:
        aliases.add(norm.replace("کوییک", "کوئیک"))
    return aliases


def _known_models(text: str, models: list[str]) -> list[str]:
    matches = [model for model in models if any(_matches(text, a) for a in _aliases(model))]
    # A full specific model wins over its proper generic-name prefix.
    return [m for m in matches if not any(_norm(m) != _norm(other) and _norm(m) in _norm(other) for other in matches)]


def _years(text: str) -> list[int]:
    candidates = {int(v) for v in re.findall(r"(?<!\d)(1[2345]\d{2})(?!\d)", text)}
    for value in re.findall(r"(?:سال|مدل|year)\s*[:：]?\s*(\d{4})(?!\d)", text):
        candidates.add(int(value))
    if re.fullmatch(r"\s*\d{4}\s*[.!؟?]?\s*", text):
        candidates.add(int(re.search(r"\d{4}", text).group()))
    return sorted(candidates)


def _conditions(text: str) -> list[str]:
    found = []
    for canonical, patterns in _CONDITION_PATTERNS.items():
        if any(re.search(r"(?<!\w)(?:" + pattern + r")(?!\w)", text) for pattern in patterns):
            found.append(canonical)
    return found


def _unknown_model(text: str, known: list[str]) -> str | None:
    matched = [name for name in _COMMON_MODELS if _matches(text, name)]
    matched = [m for m in matched if not any(m != other and _norm(m) in _norm(other) for other in matched)]
    if matched:
        # Multiple unknown names are never converted to a known catalog model.
        return " / ".join(matched[:3]).translate(_PERSIAN)
    # Capture an explicit, unknown named request instead of borrowing an old model.
    match = re.search(r"(?:خودرو|ماشین)\s+([\w\s+\-]{1,45}?)(?=\s+(?:سال|مدل|قیمت|چند)|[؟?]|$)", text)
    if match:
        name = re.sub(r"\b\d{4}\b", "", match.group(1)).strip()
        if name and name not in {"نو", "کارکرده", "صفر"}:
            return name.translate(_PERSIAN)
    if known:
        return None
    # A short unknown name adjacent to an explicit year remains unknown. It is
    # offered catalog alternatives, never completed with invented model details.
    match = re.match(r"^([\w\s+\-]{1,35}?)\s+(?:(?:سال|مدل)\s+)?(?:1[2345]\d{2})\b", text)
    if match:
        name = re.sub(r"^(?:قیمت|برای|سلام|خودرو|ماشین)\s+", "", match.group(1)).strip()
        if name and name not in {"سال", "مدل", "مدلش", "سال ساخت", "همون", "همان"}:
            return name.translate(_PERSIAN)
    return None


def _year_followup(text: str) -> bool:
    rest = re.sub(r"(?<!\d)\d{4}(?!\d)", " ", text)
    for patterns in _CONDITION_PATTERNS.values():
        for pattern in patterns:
            rest = re.sub(r"(?<!\w)(?:" + pattern + r")(?!\w)", " ", rest)
    allowed = r"(?:سال(?:\s+ساخت)?|مدلش|مدل|هستش|هست|بود|باشه|لطفا|لطفاً|ممنون|مرسی|همون|همان|می\s*خوام|می\s*خواهم|را|رو|نه|بله|آره|خیر)"
    rest = re.sub(r"(?<!\w)" + allowed + r"(?!\w)", " ", rest)
    return not re.sub(r"[\s.،,:؛!?؟\-]", "", rest)


def _safe_context(context: Any) -> dict[str, Any]:
    if not isinstance(context, dict):
        return {"model": None, "year": None, "condition": None, "pending": None}
    model = context.get("model")
    year = context.get("year")
    condition = context.get("condition")
    pending = context.get("pending")
    return {
        "model": model if isinstance(model, str) and 0 < len(model) <= 80 else None,
        "year": year if type(year) is int and 1000 <= year <= 9999 else None,
        "condition": condition if isinstance(condition, str) and condition in CONDITIONS else None,
        "pending": pending if isinstance(pending, str) and pending in {"model", "year", "choice"} else None,
    }


class _Trace:
    def __init__(self) -> None:
        self.entries: dict[str, dict[str, Any]] = {}

    def add(self, stage: str, state: str, detail: str, started: float | None = None) -> None:
        self.entries[stage] = {
            "id": stage, "title": dict(STAGES)[stage], "state": state, "detail": detail,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3) if started is not None else 0.0,
        }

    def finish(self) -> list[dict[str, Any]]:
        for stage, _ in STAGES:
            if stage not in self.entries:
                self.add(stage, "skipped", "برای این پاسخ اجرا نشد.")
        return [self.entries[key] for key, _ in STAGES]


class QuoteEngine:
    def __init__(self, csv_path: str | Path, annual_rate: Any = "23", gateway: Any = None) -> None:
        self.csv_path = Path(csv_path)
        self.annual_rate = _rate(annual_rate, "نرخ اسمی سالانه", Decimal("1000"))
        self.gateway = gateway

    def catalog(self) -> dict[str, Any]:
        try:
            raw = self.csv_path.read_bytes()
        except OSError as exc:
            raise CatalogError("فایل prices.csv در دسترس نیست؛ قیمت‌گذاری متوقف شد.") from exc
        if not raw or len(raw) > 1024 * 1024:
            raise CatalogError("فایل قیمت خالی یا بزرگ‌تر از حد مجاز است.")
        try:
            reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
            header = next(reader)
            if header != HEADERS:
                raise CatalogError("سرستون‌های prices.csv با قالب لازم مطابقت ندارند.")
            rows: list[dict[str, Any]] = []
            seen: set[tuple[str, int]] = set()
            for values in reader:
                if not values:
                    continue
                source_row = reader.line_num
                if len(values) != len(HEADERS):
                    raise CatalogError(f"تعداد ستون‌های ردیف {_fa(source_row)} معتبر نیست.")
                model = values[0].strip()
                if not model or len(model) > 80 or not _MODEL_CHARS.fullmatch(model) or re.search(r"[\r\n\t\x00-\x1f]", model):
                    raise CatalogError(f"نام خودرو در ردیف {_fa(source_row)} معتبر نیست.")
                year = _integer(values[1], "سال خودرو", 1000, 9999)
                price = _integer(values[2], "قیمت خودرو", 1, MAX_PRICE)
                try:
                    down = _rate(values[3], "درصد پیش‌پرداخت", Decimal("100"))
                except ValueError as exc:
                    raise CatalogError(str(exc)) from exc
                installments = _integer(values[4], "تعداد اقساط", 1, MAX_INSTALLMENTS)
                key = (_norm(model), year)
                if key in seen:
                    raise CatalogError(f"مدل و سال تکراری در ردیف {_fa(source_row)} وجود دارد؛ جدول کامل رد شد.")
                seen.add(key)
                row_id = "car-" + hashlib.sha256((key[0] + "|" + str(year)).encode()).hexdigest()[:16]
                rows.append({"id": row_id, "model": model, "year": year, "price_toman": str(price), "down_payment_percent": _decimal_text(down), "installments": installments, "csv_row": source_row})
                if len(rows) > MAX_ROWS:
                    raise CatalogError("تعداد ردیف‌های قیمت بیش از حد مجاز است.")
        except (UnicodeError, csv.Error, StopIteration) as exc:
            raise CatalogError("ساختار یا کدگذاری فایل prices.csv معتبر نیست.") from exc
        if not rows:
            raise CatalogError("جدول قیمت هیچ ردیف معتبری ندارد.")
        return {"rows": rows, "version": hashlib.sha256(raw).hexdigest(), "source": "prices.csv"}

    def _extract(self, text: str, rows: list[dict[str, Any]], context: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        norm = _norm(text)
        models = list(dict.fromkeys(row["model"] for row in rows))
        matches = _known_models(norm, models)
        common_mentions = [name for name in _COMMON_MODELS if _matches(norm, name)]
        common_mentions = [m for m in common_mentions if not any(m != other and _norm(m) in _norm(other) for other in common_mentions)]
        unknown_mentions = [name.translate(_PERSIAN) for name in common_mentions if not any(_norm(name) in _norm(known) or _norm(known) in _norm(name) for known in matches)]
        all_mentions = list(dict.fromkeys(matches + unknown_mentions))
        years = _years(norm)
        conditions = _conditions(norm)
        model = matches[0] if len(matches) == 1 else None
        unknown = _unknown_model(norm, matches) if not matches else None
        if unknown:
            model = unknown
        if len(all_mentions) > 1:
            model = None
        year = years[0] if len(years) == 1 else None
        condition = conditions[0] if len(conditions) == 1 else None
        inherited_model = False
        # A year-only answer may complete the pending request; arbitrary new text
        # must never inherit the previous car merely because it contains a year.
        if not model and not matches and context["model"] and _year_followup(norm):
            model = context["model"]
            inherited_model = True
            if not conditions:
                condition = context["condition"]
        elif model and context["model"] and _norm(model) == _norm(context["model"]):
            if not conditions:
                condition = context["condition"]
        # A previously supplied standalone year can complete a pending model ask.
        if model and not years and not context["model"] and context["pending"] == "model":
            year = context["year"]
        # Explicit referential follow-ups may reuse a complete prior request.
        if not model and context["model"] and context["year"] and re.fullmatch(r"(?:پیش پرداختش|پیش پرداخت|قسطش|اقساطش|قسط|اقساط|شرایطش|شرایط|همون|همان)(?:\s+(?:چقدره|چنده|چطور|چطوره|رو بگو|را بگو))?\s*[؟?.!]*", norm):
            model, year, condition = context["model"], context["year"], context["condition"]
            inherited_model = True
        return {"model": model, "year": year, "condition": condition}, {
            "models": all_mentions if len(all_mentions) > 1 else matches, "years": years, "conditions": conditions,
            "ambiguous": len(all_mentions) > 1 or len(years) > 1,
            "inherited_model": inherited_model,
            "models_allowed": models,
        }

    def _gateway_extract(self, text: str, extracted: dict[str, Any], evidence: dict[str, Any], context: dict[str, Any]) -> tuple[bool, str]:
        if self.gateway is None:
            return False, "استخراج با قواعد قطعی و تطبیق مستقیم متن انجام شد."
        try:
            slots = self.gateway.extract(text, evidence["models_allowed"], {key: context[key] for key in ("model", "year", "condition")})
            if slots is None and getattr(self.gateway, "mode", "fixture") == "fixture":
                return False, "حالت نمونه: استخراج با قواعد قطعی و متن درخواست انجام شد."
            if not isinstance(slots, dict) or set(slots) != {"model", "year", "condition"}:
                return True, "خروجی استخراج مدل نامعتبر بود؛ قواعد قطعی استفاده شد."
            if evidence["ambiguous"]:
                return True, "ابهام متن با حدس مدل رفع نشد؛ انتخاب دقیق از مشتری خواسته می‌شود."
            for field in ("model", "year", "condition"):
                got, expected = slots[field], extracted[field]
                if field == "year" and got is not None and type(got) is not int:
                    return True, "سال خروجی مدل معتبر نبود؛ قواعد قطعی استفاده شد."
                if field == "model" and got is not None:
                    if not isinstance(got, str) or not expected or _norm(got) != _norm(expected):
                        return True, "نام خودروی مدل با شواهد پیام هماهنگ نبود؛ حدس کنار گذاشته شد."
                elif got != expected:
                    return True, "اطلاعات خروجی مدل با متن و سابقهٔ مجاز هماهنگ نبود؛ قواعد قطعی استفاده شد."
            return False, "مدل اطلاعات درخواست را استخراج کرد و هر فیلد با متن و سابقهٔ مجاز تطبیق داده شد."
        except Exception as exc:  # The gateway may raise provider errors containing secrets; do not echo them.
            return True, "استخراج مدل در دسترس نبود؛ مسیر قطعی جایگزین شد. نوع خطا: " + type(exc).__name__

    def _financial_quote(self, row: dict[str, Any], version: str, condition: str | None) -> dict[str, Any]:
        with localcontext() as ctx:
            ctx.prec = 80
            price = Decimal(row["price_toman"])
            down = (price * Decimal(row["down_payment_percent"]) / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)
            principal = price - down
            count = row["installments"]
            rate = self.annual_rate / Decimal(1200)
            pmt = principal / count if rate == 0 else principal * rate / (1 - (1 + rate) ** (-count))
            payment = pmt.quantize(Decimal(1), rounding=ROUND_HALF_UP)
            balance = principal
            schedule = []
            for number in range(1, count + 1):
                interest = (balance * rate).quantize(Decimal(1), rounding=ROUND_HALF_UP)
                actual = balance + interest if number == count else payment
                principal_part = actual - interest
                if principal_part < 0 or principal_part > balance:
                    raise CalculationError("این مبلغ و تعداد قسط با گرد کردن به تومان سازگار نیست؛ بررسی انسانی لازم است.")
                balance -= principal_part
                schedule.append({"number": number, "payment_toman": str(int(actual)), "interest_toman": str(int(interest)), "principal_toman": str(int(principal_part)), "balance_toman": str(int(balance))})
            total_installments = sum(Decimal(p["payment_toman"]) for p in schedule)
            total_interest = sum(Decimal(p["interest_toman"]) for p in schedule)
            final = Decimal(schedule[-1]["payment_toman"])
            condition_note = (f"وضعیت درخواستی: {condition}. " if condition else "") + "نو یا کارکرده بودن در CSV ثبت نشده و باید توسط فروشنده تأیید شود."
            quote = {
                "model": row["model"], "year": row["year"], "price_toman": row["price_toman"],
                "down_payment_percent": row["down_payment_percent"], "down_payment_toman": str(int(down)),
                "principal_toman": str(int(principal)), "installments": count,
                "annual_rate_percent": _decimal_text(self.annual_rate), "monthly_payment_toman": str(int(payment)),
                "final_payment_toman": str(int(final)), "total_installments_toman": str(int(total_installments)),
                "total_paid_toman": str(int(down + total_installments)), "total_interest_toman": str(int(total_interest)),
                "source_row": row["csv_row"], "source_version": version, "condition_note": condition_note,
                "payment_schedule": schedule,
            }
            self._validate_quote(quote, row, version)
            return quote

    @staticmethod
    def _validate_quote(quote: dict[str, Any], row: dict[str, Any], version: str) -> None:
        for field in ("model", "year", "price_toman", "down_payment_percent", "installments"):
            if quote[field] != row[field]:
                raise CalculationError("اطلاعات پیش‌فاکتور با ردیف منبع هماهنگ نیست.")
        if quote["source_version"] != version or quote["source_row"] != row["csv_row"]:
            raise CalculationError("منشأ پیش‌فاکتور قابل تأیید نیست.")
        price, down, principal = (int(quote[k]) for k in ("price_toman", "down_payment_toman", "principal_toman"))
        if down + principal != price:
            raise CalculationError("جمع پیش‌پرداخت و اصل تسهیلات معتبر نیست.")
        previous = principal
        for index, part in enumerate(quote["payment_schedule"], 1):
            paid, interest, principal_part, balance = (int(part[k]) for k in ("payment_toman", "interest_toman", "principal_toman", "balance_toman"))
            if part["number"] != index or min(paid, interest, principal_part, balance) < 0 or paid != interest + principal_part or previous - principal_part != balance:
                raise CalculationError("ریز اقساط معتبر نیست.")
            if index < quote["installments"] and paid != int(quote["monthly_payment_toman"]):
                raise CalculationError("مبلغ اقساط ثابت با برنامهٔ پرداخت هماهنگ نیست.")
            previous = balance
        if previous != 0 or len(quote["payment_schedule"]) != quote["installments"]:
            raise CalculationError("ماندهٔ نهایی اقساط صفر نشده است.")
        if quote["payment_schedule"][-1]["payment_toman"] != quote["final_payment_toman"]:
            raise CalculationError("مبلغ قسط آخر با برنامهٔ پرداخت هماهنگ نیست.")
        totals = {key: sum(int(v[key]) for v in quote["payment_schedule"]) for key in ("payment_toman", "interest_toman", "principal_toman")}
        if totals["principal_toman"] != principal or totals["payment_toman"] != int(quote["total_installments_toman"]) or totals["interest_toman"] != int(quote["total_interest_toman"]):
            raise CalculationError("جمع ریز اقساط معتبر نیست.")
        if down + totals["payment_toman"] != int(quote["total_paid_toman"]) or int(quote["total_paid_toman"]) - price != totals["interest_toman"]:
            raise CalculationError("جمع پرداخت و سود معتبر نیست.")

    def _quote_body(self, quote: dict[str, Any]) -> str:
        q = quote
        lines = [
            f"پیش‌فاکتور {q['model']}، مدل {_fa(q['year'])}",
            f"قیمت خودرو: {_fa(q['price_toman'], True)} تومان",
            f"پیش‌پرداخت {_fa(q['down_payment_percent'])}٪: {_fa(q['down_payment_toman'], True)} تومان",
            f"اصل تسهیلات: {_fa(q['principal_toman'], True)} تومان",
            f"تعداد اقساط: {_fa(q['installments'])} ماه",
            f"قسط ماهانه: {_fa(q['monthly_payment_toman'], True)} تومان",
        ]
        if q["final_payment_toman"] != q["monthly_payment_toman"]:
            lines.append(f"قسط آخر برای تسویهٔ دقیق: {_fa(q['final_payment_toman'], True)} تومان")
        lines.extend([
            f"جمع اقساط: {_fa(q['total_installments_toman'], True)} تومان",
            f"جمع سود محاسباتی: {_fa(q['total_interest_toman'], True)} تومان",
            f"کل پرداخت با پیش‌پرداخت: {_fa(q['total_paid_toman'], True)} تومان",
            "",
            f"فرض محاسبه: نرخ اسمی سالانهٔ {_fa(q['annual_rate_percent'])}٪، اقساط پایان ماه و سود بر ماندهٔ اصل تسهیلات.",
            "پیش‌پرداخت، سود هر دوره و مبلغ قسط با روش نیم‌به‌بالا به تومان گرد می‌شوند؛ قیمت CSV بدون گرد کردن حفظ می‌شود. قسط آخر مانده را تسویه می‌کند.",
            "کارمزد، بیمه و هزینه‌های جانبی در این محاسبه نیستند.",
            q["condition_note"],
            f"منبع قیمت و شرایط پایه: prices.csv، ردیف {_fa(q['source_row'])}؛ نسخه {q['source_version'][:12]}.",
        ])
        return "\n".join(lines)

    def _alternatives(self, rows: list[dict[str, Any]], extracted: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        model, year = extracted["model"], extracted["year"]
        same_model = [r for r in rows if model and _norm(r["model"]) == _norm(model)]
        prefix_model = [r for r in rows if model and (_norm(r["model"]).startswith(_norm(model) + " ") or _norm(model).startswith(_norm(r["model"]) + " "))]
        same_year = [r for r in rows if year and r["year"] == year]
        if same_model:
            selected, criterion = same_model[:3], "مدل یکسان و سال‌های موجود در جدول"
        elif prefix_model:
            selected, criterion = sorted(prefix_model, key=lambda r: r["year"] != year)[:3], "نام نزدیک با مشخصات دقیق‌ترِ موجود در جدول؛ نوع خودرو باید توسط خودت انتخاب شود"
        elif same_year:
            selected, criterion = same_year[:3], "سال یکسان و خودروهای دیگری که واقعاً در جدول هستند"
        else:
            selected, criterion = rows[:3], "ردیف‌های موجود جدول؛ تطابق دقیق با درخواست پیدا نشد"
        requested = (model or "خودروی درخواستی") + (f" مدل {_fa(year)}" if year else "")
        lines = [f"برای {requested} ردیف دقیق نداریم؛ پیش‌فاکتور جایگزین خودکار صادر نمی‌کنم.", f"معیار این گزینه‌ها: {criterion}."]
        options = []
        for row in selected:
            label = f"{row['model']} · {_fa(row['year'])} · {_fa(row['price_toman'], True)} تومان"
            lines.append("• " + label)
            options.append({"label": label, "text": f"{row['model']} سال {_fa(row['year'])}", "row_id": row["id"]})
        lines.append("اگر یکی از این ردیف‌ها منظورت است، همان را انتخاب کن.")
        if extracted["condition"]:
            lines.append("نو یا کارکرده بودن هیچ‌کدام در جدول ثبت نشده و نیاز به تأیید فروشنده دارد.")
        return "\n".join(lines), options

    def process(self, text: str, context: Any = None, request_id: Any = None) -> dict[str, Any]:
        trace = _Trace()
        started = time.perf_counter()
        ctx = _safe_context(context)
        base_mode = getattr(self.gateway, "mode", "fixture") if self.gateway else "fixture"
        mode = base_mode if base_mode in {"fixture", "live", "fallback"} else "fallback"
        result: dict[str, Any] = {
            "status": "blocked", "reply": "", "options": [],
            "extracted": {"model": None, "year": None, "condition": None}, "quote": None,
            "context": ctx, "trace": [], "source": {"name": "prices.csv", "version": None}, "mode": mode,
        }
        if not isinstance(text, str) or len(text) > 6000:
            trace.add("intake", "blocked", "پیام باید متن و حداکثر ۶۰۰۰ نویسه باشد.", started)
            result["reply"] = "پیام را به شکل متن کوتاه همراه مدل و سال خودرو بفرست."
            result["trace"] = trace.finish()
            return result
        text = text.strip()
        trace.add("intake", "passed", "متن دریافت شد؛ اطلاعات مالی پیام، منبع قیمت‌گذاری نیست.", started)
        source_start = time.perf_counter()
        try:
            # Exactly one validated snapshot per process call. The next request
            # rereads the file; an atomic concurrent edit cannot mix versions.
            catalog = self.catalog()
        except CatalogError as exc:
            trace.add("lookup", "blocked", str(exc), source_start)
            result["reply"] = "قیمت‌گذاری متوقف شد: " + str(exc) + "\nتا اصلاح منبع، هیچ مبلغی اعلام نمی‌کنم."
            result["trace"] = trace.finish()
            return result
        result["source"]["version"] = catalog["version"]
        rows = catalog["rows"]
        extraction_start = time.perf_counter()
        extracted, evidence = self._extract(text, rows, ctx)
        gateway_fallback, extraction_detail = self._gateway_extract(text, extracted, evidence, ctx)
        if gateway_fallback:
            result["mode"] = "fallback"
        result["extracted"] = extracted
        result["context"] = {**extracted, "pending": None}
        trace.add("extraction", "waiting" if evidence["ambiguous"] else "passed", extraction_detail, extraction_start)
        lookup_start = time.perf_counter()
        norm = _norm(text)
        condition_note = "\nنو یا کارکرده بودن در جدول ثبت نشده؛ این مورد باید توسط فروشنده تأیید شود." if extracted["condition"] or len(evidence["conditions"]) > 1 else ""
        body = ""
        row = None
        if not norm or norm in {"سلام", "درود", "سلام وقت بخیر", "/start", "شروع", "شروع دوباره", "help"}:
            result["status"] = "welcome"
            result["context"] = {"model": None, "year": None, "condition": None, "pending": "model"}
            body = "برای پیش‌فاکتور، مدل و سال خودرو را بنویس؛ مثلاً «پژو ۲۰۷ مدل ۱۴۰۲». قیمت و شرایط فقط از جدول نمونهٔ prices.csv خوانده می‌شوند."
            seen = set()
            for item in rows:
                if item["model"] not in seen and len(result["options"]) < 3:
                    result["options"].append({"label": item["model"], "text": item["model"]})
                    seen.add(item["model"])
            trace.add("lookup", "skipped", "پیام خوشامد؛ هیچ خودرویی برای قیمت‌گذاری انتخاب نشد.", lookup_start)
        elif evidence["ambiguous"]:
            result["status"] = "clarify"
            result["context"]["pending"] = "choice"
            if len(evidence["years"]) > 1:
                body = "در پیام بیش از یک سال آمده: " + "، ".join(_fa(y) for y in evidence["years"]) + ". کدام سال را می‌خواهی؟ هیچ سالی را خودکار انتخاب نکردم." + condition_note
                result["context"]["year"] = None
                for year in evidence["years"][:3]:
                    result["options"].append({"label": f"مدل {_fa(year)}", "text": (extracted["model"] + " " if extracted["model"] else "") + "سال " + _fa(year)})
            else:
                body = "بیش از یک خودرو در پیام آمده. کدام مدل را بررسی کنم؟"
                result["context"]["model"] = None
                for model in evidence["models"][:3]:
                    result["options"].append({"label": model, "text": model + (" سال " + _fa(extracted["year"]) if extracted["year"] else "")})
            trace.add("lookup", "waiting", "درخواست مبهم است؛ هیچ ردیفی انتخاب نشد.", lookup_start)
        elif not extracted["model"]:
            result["status"] = "clarify"
            result["context"]["pending"] = "model"
            body = "مدل دقیق خودرو را بگو تا همان ردیف جدول را بررسی کنم." + condition_note
            trace.add("lookup", "waiting", "نام دقیق خودرو در پیام یا سابقهٔ مجاز مشخص نیست.", lookup_start)
        elif extracted["year"] is None:
            result["status"] = "clarify"
            result["context"]["pending"] = "year"
            body = f"{extracted['model']} مدل کدام سال را می‌خواهی؟ سال ساخت را بگو؛ «نو» جای سال نیست." + condition_note
            matching = [r for r in rows if _norm(r["model"]) == _norm(extracted["model"])]
            for item in matching[:3]:
                result["options"].append({"label": "مدل " + _fa(item["year"]), "text": _fa(item["year"]), "row_id": item["id"]})
            trace.add("lookup", "waiting", "سال ساخت مشخص نیست؛ جدیدترین سال انتخاب نشد.", lookup_start)
        else:
            row = next((r for r in rows if _norm(r["model"]) == _norm(extracted["model"]) and r["year"] == extracted["year"]), None)
            if row is None:
                result["status"] = "alternatives"
                result["context"]["pending"] = "choice"
                body, result["options"] = self._alternatives(rows, extracted)
                trace.add("lookup", "waiting", "ردیف دقیق موجود نیست؛ گزینه‌ها فقط از همین نسخهٔ CSV هستند.", lookup_start)
            else:
                result["source"]["row"] = row["csv_row"]
                trace.add("lookup", "passed", f"تطابق دقیق مدل و سال در ردیف {_fa(row['csv_row'])}؛ نسخهٔ {catalog['version'][:12]}.", lookup_start)
                calc_start = time.perf_counter()
                try:
                    result["quote"] = self._financial_quote(row, catalog["version"], extracted["condition"])
                    result["status"] = "quote"
                    body = self._quote_body(result["quote"])
                    trace.add("calculation", "passed", "محاسبهٔ Decimal و تطبیق ریز اقساط، اصل تسهیلات و ماندهٔ نهایی انجام شد.", calc_start)
                except (CalculationError, InvalidOperation, ArithmeticError) as exc:
                    result["status"] = "blocked"
                    result["quote"] = None
                    body = str(exc) if isinstance(exc, CalculationError) else "محاسبهٔ این شرایط قابل تأیید نیست؛ بررسی انسانی لازم است."
                    trace.add("calculation", "blocked", body, calc_start)
        compose_start = time.perf_counter()
        phrasing = {"opening_id": "hello", "closing_id": "review"}
        phrase_detail = "حالت نمونه: عبارت‌های ثابتِ تأییدشده استفاده شد و تمام متن مالی را کد ساخت."
        if self.gateway is not None:
            try:
                candidate = self.gateway.phrase(result["status"])
                if not isinstance(candidate, dict) or set(candidate) != {"opening_id", "closing_id"} or candidate["opening_id"] not in OPENINGS or candidate["closing_id"] not in CLOSINGS:
                    raise ValueError("Invalid approved phrase identifiers")
                phrasing = candidate
                phrase_detail = "حالت نمونه: عبارت‌های ثابتِ تأییدشده استفاده شد؛ هیچ مدل زنده‌ای برای نگارش فراخوانی نشد." if base_mode == "fixture" else "فقط شناسهٔ عبارت‌های تأییدشده از مدل پذیرفته شد؛ تمام اعداد و متن مالی را کد ساخت."
            except Exception as exc:
                result["mode"] = "fallback"
                phrase_detail = "انتخاب عبارت مدل معتبر یا در دسترس نبود؛ متن تأییدشدهٔ ثابت استفاده شد. نوع خطا: " + type(exc).__name__
        closing = CLOSINGS[phrasing["closing_id"]] if result["status"] == "quote" else "برای ادامه، مدل و سال دقیق را مشخص کن." if result["status"] in {"clarify", "alternatives"} else ""
        result["reply"] = "\n\n".join(part for part in (OPENINGS[phrasing["opening_id"]], body, closing) if part)
        trace.add("composition", "passed", phrase_detail, compose_start)
        validation_start = time.perf_counter()
        if result["quote"] is not None:
            try:
                self._validate_quote(result["quote"], row, catalog["version"])
                trace.add("validation", "passed", "قیمت، پیش‌پرداخت و تعداد اقساط با منبع تطبیق دارند؛ جمع اقساط و ماندهٔ صفر تأیید شد.", validation_start)
            except (CalculationError, KeyError, ValueError, TypeError, ArithmeticError):
                result["status"] = "blocked"
                result["quote"] = None
                result["reply"] = "کنترل نهایی موفق نبود؛ هیچ پیش‌فاکتوری صادر نشد. منبع قیمت و محاسبات باید بررسی شوند."
                trace.add("validation", "blocked", "کنترل نهایی شکست خورد؛ پاسخ مالی کنار گذاشته شد.", validation_start)
        else:
            trace.add("validation", "passed", "هیچ پیش‌فاکتور یا مبلغ خارج از ردیف‌های معتبر جدول ساخته نشد.", validation_start)
        result["trace"] = trace.finish()
        return result
