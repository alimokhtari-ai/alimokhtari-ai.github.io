"""Create the submission archive from an explicit allowlist; never copy runtime."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "deliverables"
OUT.mkdir(exist_ok=True)

base_files = ["README.md", ".gitignore", ".env.example", "server.py", "workflow.py", "quote_engine.py", "model_gateway.py", "telegram_bot.py", "workflow.json", "start-mac.command", "start-windows.bat", "package.py", "render_demo.py"]
files = [ROOT / name for name in base_files]
for folder in ["data", "web", "docs", "prompts", "tests"]:
    files.extend(path for path in (ROOT / folder).rglob("*") if path.is_file() and "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"})
for name in ["browser-results.json", "python-results.json", "demo-results.json", "qa-desktop-1440.png", "qa-mobile-390.png"]:
    file = ROOT / "evidence" / name
    if file.exists():
        files.append(file)
files = sorted(set(files))

assert (ROOT / "data/prices.csv").read_bytes().hex(), "Source CSV missing"
source_hash = hashlib.sha256((ROOT / "data/prices.csv").read_bytes()).hexdigest()
assert source_hash == "88d1496cc865b5fdd7881539d2c8c4df9964abcfc2a4d6d5cf204fb197e7961e", "Do not ship the modified video fixture"
for file in files:
    relative = file.relative_to(ROOT)
    assert not any(part in {".runtime", "runtime", ".venv", "node_modules", ".git"} for part in relative.parts)
    assert file.name != ".env" and file.suffix not in {".sqlite", ".sqlite3", ".db", ".mp4", ".webm"}
    if file.name == ".env.example":
        env = file.read_text()
        for key in ["GROQ_API_KEY", "TELEGRAM_BOT_TOKEN"]:
            assert not re.search(r"^" + key + r"=\S+", env, re.MULTILINE), "Credential template must stay empty"
    if file.suffix in {".py", ".js", ".cjs", ".md", ".json", ".txt", ".html"}:
        content = file.read_text(encoding="utf-8")
        assert not re.search(r"(?:ghp_|github_pat_|gsk_)[A-Za-z0-9_]{20,}", content), "Possible credential pattern in source"

archive = OUT / "RAVAL-VC005.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for file in files:
        target.write(file, "RAVAL-VC005/" + file.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as target:
    assert target.testzip() is None
    assert target.read("RAVAL-VC005/data/prices.csv") == (ROOT / "data/prices.csv").read_bytes()
    assert target.read("RAVAL-VC005/web/app.js") == (ROOT / "web/app.js").read_bytes()

prompts = ["# پنج پرامپت کلیدی روال · VC-005\n", "این متن‌ها بازنویسی فشردهٔ درخواست‌های ساخت و بازبینی این پروژه‌اند؛ رونویسی کلمه‌به‌کلمهٔ گفت‌وگو نیستند. پرامپت‌های زمان اجرای اتصال مدل در `model_gateway.py` قرار دارند.\n"]
labels = ["قرارداد محصول و مرز ادعاها", "محاسبه و منبع عددها", "مرز مدل زبانی", "هماهنگ‌کننده، رابط و کانال پیام", "بررسی، ویدیو و تحویل"]
for index, (file, label) in enumerate(zip(sorted((ROOT / "prompts").glob("*.txt")), labels), 1):
    prompts.append(f"## {str(index).translate(str.maketrans('12345', '۱۲۳۴۵'))}. {label}\n\n{file.read_text().strip()}\n")
(OUT / "RAVAL-VC005-Prompts.md").write_text("\n".join(prompts), encoding="utf-8")
shutil.copyfile(ROOT / "workflow.json", OUT / "RAVAL-workflow.json")
guide = """# روال · راهنمای دریافت و ارسال

## اجرای پروژه

ZIP را از حالت فشرده خارج کن. به Python 3.10 یا جدیدتر نیاز داری؛ نصب پکیج لازم نیست. در Windows فایل `start-windows.bat` و در Mac فایل `start-mac.command` را اجرا کن. ترمینال باید باز بماند.

راه مستقیم:

```sh
python3 server.py
```

در Windows می‌توانی `py -3 server.py` را اجرا کنی. سپس `http://127.0.0.1:8765` را در مرورگر باز کن.

## معرفی آماده برای بات

«روال» رو ساختم؛ دستیار پیش‌فاکتور خودرو که درخواست مشتری رو می‌گیره، مدل و سال رو مشخص می‌کنه و قیمت و شرایط رو از CSV می‌خونه. اقساط با کد Python حساب می‌شن و کنار هر پاسخ، ردیف منبع و مسیر پردازش دیده می‌شه. اگر سال معلوم نباشه سؤال می‌پرسه؛ اگر خودرو توی جدول نباشه، از ردیف‌های واقعی گزینه پیشنهاد می‌ده. برای این تحویل، خواندن فایل و محاسبات واقعاً اجرا می‌شن؛ مدل در حالت نمونه است و پنل تلگرام شبیه‌سازه. کد اتصال Groq و بات تلگرام هم آماده است.

## فایل‌های تحویل

- `RAVAL-VC005-Demo.mp4`: حدود ۱ دقیقه و ۴۵ ثانیه ضبط واقعی، با زیرنویس فارسی.
- `RAVAL-VC005.zip`: کد کامل، CSV اصلی، رابط، آداپترهای اختیاری، تست‌ها و راهنماها.
- `RAVAL-VC005-Prompts.md`: پنج پرامپت کلیدی.
- `RAVAL-workflow.json`: توصیف مسیر پایتون؛ فایل import برای n8n نیست.

## وضعیت دقیق نسخه

منبع قیمت CSV است و در هر درخواست دوباره خوانده می‌شود. رابط واقعاً به سرور محلی پاسخ می‌فرستد. مدل در حالت پیش‌فرض نمونه و قواعد قرار دارد؛ تماس زنده با Groq و Telegram در این نسخهٔ ضبط‌شده فعال نشده است. این جایگزین‌ها در صورت تسک پذیرفته شده‌اند و محدودیت در ویدیو و README روشن است.

برای اتصال واقعی، راهنمای `docs/CONNECTING-fa.md` داخل ZIP را دنبال کن. کلیدها فقط به‌صورت متغیر محیطی روی سیستم خودت تنظیم می‌شوند. هیچ کلید یا پایگاه دادهٔ گفت‌وگویی داخل ZIP نیست.

## کنترل‌های انجام‌شده

۸۰ آزمون پایتون و ۱۵ سناریوی مرورگر موفق‌اند. سؤال مبهم «۲۰۷ نو چند؟»، نبود خودرو، حفظ دقیق قیمت نامنظم، گردکردن اقساط و تسویهٔ قسط آخر، ویرایش هم‌زمان جدول و قطع ارتباط بررسی شده‌اند. مرورگر در عرض‌های ۳۲۰، ۳۹۰، ۷۶۸ و ۱۴۴۰ پیکسل آزموده شده؛ گوشی فیزیکی و اتصال خارجی آزموده نشده‌اند.

نرخ نمونه، سالانهٔ اسمی ۲۳٪ با محاسبه روی ماندهٔ بدهی است. قیمت‌های CSV دادهٔ آموزشی تسک‌اند. وضعیت موجودی، نو یا کارکرده بودن و هزینه‌های جانبی در این جدول وجود ندارند.

سه سؤال کوتاهِ فرم هنوز ارائه نشده‌اند؛ متن معرفی بالا جای پاسخ دقیق به سؤال‌های ندیده را نمی‌گیرد.
"""
(OUT / "RAVAL-VC005-Guide.md").write_text(guide, encoding="utf-8")
print(json.dumps({"archive": str(archive), "files": len(files), "bytes": archive.stat().st_size, "original_csv_preserved": True, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}, ensure_ascii=False))
