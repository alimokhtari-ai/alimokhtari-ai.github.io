#!/usr/bin/env python3
"""Build one offline HTML file. Python standard library only; no network."""
from pathlib import Path
import base64

ROOT = Path(__file__).resolve().parent
font = base64.b64encode((ROOT / 'assets/Estedad-variable.woff2').read_bytes()).decode('ascii')
css = (ROOT / 'src/style.css').read_text(encoding='utf-8').replace('__FONT__', font)
core = (ROOT / 'src/core.js').read_text(encoding='utf-8')
app = (ROOT / 'src/app.js').read_text(encoding='utf-8')
license_text = (ROOT / 'assets/OFL-Estedad.txt').read_text(encoding='utf-8').replace('</script', '<\\/script')
html = (ROOT / 'src/shell.html').read_text(encoding='utf-8')
for token, value in [('/*__STYLE__*/',css),('/*__CORE__*/',core),('/*__APP__*/',app),('/*__FONT_LICENSE__*/',license_text)]:
    assert html.count(token) == 1, token
    html = html.replace(token, value)
(ROOT / 'index.html').write_text(html, encoding='utf-8')
print(f'Built index.html: {len(html.encode("utf-8")):,} bytes. Fully embedded CSS, JavaScript and Estedad font.')
