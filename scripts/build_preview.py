"""Build a dependency-free engineering preview, not a replacement for MedTator."""
from pathlib import Path
import hashlib
import json
import shutil
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'preview'
HEADERS = """/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
"""

def offline_assets(out: Path) -> None:
    inventory=[]
    for p in sorted(out.rglob('*')):
        if p.is_file() and p.name not in ('asset-manifest.json','service-worker.js','_headers'):
            if p.stat().st_size > 25*1024*1024:
                raise ValueError(f'Cloudflare static file limit: {p}')
            data=p.read_bytes()
            inventory.append({'path':p.relative_to(out).as_posix(),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
    digest=hashlib.sha256(json.dumps(inventory,sort_keys=True).encode()).hexdigest()
    (out/'asset-manifest.json').write_text(json.dumps({'version':digest,'assets':inventory},indent=2))
    sw=(ROOT/'deployment/service-worker.js').read_text().replace('__BUILD_HASH__',digest)
    (out/'service-worker.js').write_text(sw)

if __name__=='__main__':
    if OUT.exists():shutil.rmtree(OUT)
    shutil.copytree(ROOT/'src/nextmedtator',OUT/'app/nextmedtator')
    (OUT/'index.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NextMedTator engineering preview</title></head>
<body><nextmedtator-workspace standalone></nextmedtator-workspace><script type="module" src="./app/nextmedtator/ui.mjs"></script></body></html>''')
    (OUT/'_headers').write_text(HEADERS)
    offline_assets(OUT)
    print(f'Built isolated review-workspace preview: {OUT}')
