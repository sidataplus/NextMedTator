"""Real IndexedDB chunking, injected quota/cancellation, and read-back integrity."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/storage';OUT.mkdir(parents=True,exist_ok=True)
checks=Path(__file__).with_name('model_storage_checks.js').read_text(encoding='utf-8')
results=[]
with sync_playwright() as p:
    for engine in ('chromium','webkit'):
        browser=getattr(p,engine).launch(**({'executable_path':chromium_path()} if engine=='chromium' else {}))
        page=browser.new_page()
        page.goto(os.environ.get('NMT_DEPLOYED_URL','http://127.0.0.1:4299/'))
        result=page.evaluate(checks)
        results.append({'engine':engine,'version':browser.version,**result})
        print(results[-1],flush=True);browser.close()
(OUT/'report.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
