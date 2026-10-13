"""Static prefix, headers and real WASM worker check; synthetic graph fixture only."""
from browser_support import chromium_path
import json, threading, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from gliner_worker_fixture import package_bytes
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from scripts.serve_static import Handler as StaticHandler, StaticServer
ROOT=Path(__file__).resolve().parents[2]
class Handler(StaticHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'dist'),**kwargs)
 def translate_path(self,path):
  path=urllib.parse.urlsplit(path).path
  if not path.startswith('/nmt/'):return str(ROOT/'dist/absent')
  return super().translate_path(path[4:])
 def log_message(self,*args):pass
server=StaticServer(('127.0.0.1',4205),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=chromium_path(),args=['--no-sandbox']);page=browser.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
  response=page.goto('http://127.0.0.1:4205/nmt/');page.wait_for_function('()=>!!window.app_hotpot?.vpp');page.evaluate('jarvis.ssclose()')
  assert response.headers['cross-origin-opener-policy']=='same-origin'
  assert response.headers['cross-origin-embedder-policy']=='require-corp'
  assert page.evaluate('crossOriginIsolated')
  report=page.evaluate('''async bytes=>{const {importModelPackage,ConformanceWorker}=await import('./app/nextmedtator/model-package.mjs');const model=await importModelPackage(new Uint8Array(bytes));const runner=new ConformanceWorker();return await runner.run(model,'wasm');}''',list(package_bytes(structured=True)))
  assert report['pass'],report
  assert not errors,errors
  assert all(url.startswith('http://127.0.0.1:4205/nmt/') for url in requests),requests
  result={'staticPrefix':'/nmt/','crossOriginIsolated':True,'syntheticWasmWorkerConformance':True,'allAssetsScoped':True,'pageErrors':[],'realBpsdBrowserInference':False}
  (ROOT/'test-results/static-prefix.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
finally:server.shutdown();server.server_close()
