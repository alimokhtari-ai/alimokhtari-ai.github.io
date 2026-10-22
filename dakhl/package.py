#!/usr/bin/env python3
"""Package the tested offline app, readable sources and delivery documents."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'deliverables'
OUT.mkdir(exist_ok=True)

paths = [ROOT / name for name in ['index.html', 'README.txt', 'build.py', 'package.py']]
for folder in ['src', 'docs', 'assets', 'tests', 'examples']:
    for path in sorted((ROOT / folder).rglob('*')):
        if not path.is_file() or path.name.startswith('.'):
            continue
        if path.suffix.lower() not in {'.html','.js','.css','.cjs','.py','.md','.txt','.json','.csv','.woff2'}:
            continue
        if path.name == 'font-tree.json':
            continue
        paths.append(path)

manifest = {
    'project': 'Dakhl',
    'applicant': 'VC-005',
    'entrypoint': 'index.html',
    'currency': 'IRT / toman; integer',
    'runtime_dependencies': [],
    'checks': {'core_scenarios':15,'browser_scenarios':18,'preservation_regressions':3},
    'files': [{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
}
archive = OUT / 'DAKHL-VC005.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in paths:
        z.write(path, str(Path('DAKHL-VC005') / path.relative_to(ROOT)))
    z.writestr('DAKHL-VC005/MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None, 'Archive CRC verification failed'
    assert z.read('DAKHL-VC005/index.html') == (ROOT/'index.html').read_bytes()
    assert not any(n.endswith(('.png','.webm','.mp4')) for n in z.namelist())

shutil.copyfile(ROOT/'index.html',OUT/'DAKHL-VC005.html')
shutil.copyfile(ROOT/'docs/KEY-PROMPTS-fa.md',OUT/'DAKHL-VC005-Prompts.md')
print(json.dumps({'zip':str(archive),'zip_bytes':archive.stat().st_size,'files':len(paths)+1,'html_bytes':(ROOT/'index.html').stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2))
