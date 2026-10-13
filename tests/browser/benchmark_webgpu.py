"""Real P10/BPSD entity + attribute inference on installed Chrome, no mocked predictions.

Requires work/final-r2-{p10,bpsd}, work/{profile}-export.json and built dist/vendor.
Run: uv run --locked python tests/browser/benchmark_webgpu.py
"""
import json, threading, statistics, argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import chromium_path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'temp/browser-validation/webgpu'
OUT.mkdir(parents=True, exist_ok=True)
catalog = json.loads((ROOT/'deployment/production-model-catalog.json').read_text())

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs':'text/javascript'}
    def translate_path(self, path):
        path = path.split('?')[0]
        if path.startswith('/app/nextmedtator/'):
            return str(ROOT/'src/nextmedtator'/path[len('/app/nextmedtator/'):])
        if path.startswith('/models/'):
            _, _, profile, rest = path.split('/',3)
            folder = next((ROOT/'work'/('final-r2-'+profile)).iterdir())
            return str(folder/rest)
        return str(ROOT/'dist'/path.lstrip('/'))
    def do_GET(self):
        if self.path=='/instrumented-worker.mjs':
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers()
            self.wfile.write(b"const queue=[];self.onmessage=e=>queue.push(e);let submits=0;if(self.GPUQueue){const submit=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(...args){submits++;return submit.apply(this,args);};}const post=self.postMessage.bind(self);self.postMessage=data=>{if(data.result){data.result={...data.result,gpuSubmissions:submits};submits=0;}post(data);};await import('/app/nextmedtator/onnx-worker.mjs');for(const e of queue)self.onmessage(e);")
        elif self.path=='/benchmark':
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers()
            self.wfile.write(b'<!doctype html><title>NextMedTator real WebGPU benchmark</title><h1>Real model benchmark</h1>')
        else: super().do_GET()
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        super().end_headers()
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',4296),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
parser=argparse.ArgumentParser();parser.add_argument('--profile',choices=['p10','bpsd']);parser.add_argument('--repeats',type=int,default=3);parser.add_argument('--debug',action='store_true')
parser.add_argument('--backend',choices=['webgpu','wasm'])
args=parser.parse_args()
try:
    with sync_playwright() as p:
        for profile in ([args.profile] if args.profile else ['p10','bpsd']):
            browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
            page=browser.new_page();page.set_default_timeout(900000)
            page.on('console',lambda msg:print(msg.type+': '+msg.text[:500],flush=True))
            page.goto('http://127.0.0.1:4296/benchmark')
            reference=json.loads((ROOT/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))
            entry=catalog['entries'][0 if profile=='p10' else 1]
            result=page.evaluate('''async ({profile,entry,reference,repeats,debug,onlyBackend})=>{
              const {schemaFromEntityContract,compareEntityContractRecords}=await import('/app/nextmedtator/entity-contract.mjs');
              const files=await Promise.all(entry.manifest.files.map(async f=>[f.path,new Uint8Array(await (await fetch('/models/'+profile+'/'+f.path)).arrayBuffer())]));
              const schema=schemaFromEntityContract(reference.contract),variant=entry.manifest.variants[0],runs=[];
              const adapter=await navigator.gpu?.requestAdapter();
              const gpu=adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null;
              for(const backend of (onlyBackend?[onlyBackend]:['webgpu','wasm'])){
                const worker=new Worker('/instrumented-worker.mjs',{type:'module'});
                const call=data=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Benchmark operation timed out')),90000);worker.onmessage=({data})=>{if(data.error||data.result)clearTimeout(timer);data.error?reject(Error(data.error)):data.result?resolve(data.result):null;};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(data);});
                const run={backend,cases:[]};
                try{
                  let start=performance.now();await call({task:'load',manifest:entry.manifest,manifestHash:entry.revision,variantId:variant.id,files,backend,diagnostics:debug});run.loadMs=performance.now()-start;
                  console.log(profile+' '+backend+' loaded '+Math.round(run.loadMs)+'ms');
                  start=performance.now();try{run.conformance=await call({task:'fixtures'});}catch(e){run.conformanceError=String(e);console.error('Conformance: '+e);}run.conformanceMs=performance.now()-start;
                  for(let repeat=0;repeat<repeats;repeat++)for(const [index,note]of reference.native.entries()){
                    start=performance.now();const actual=await call({task:'analyze',text:note.text,schema});const durationMs=performance.now()-start;
                    const check=compareEntityContractRecords(note.records,actual.records);
                    run.cases.push({repeat,index,durationMs,check,status:actual.status,records:actual.records,gpuSubmissions:actual.gpuSubmissions,wasmThreads:actual.wasmThreads,graphTransforms:actual.graphTransforms});
                    console.log(profile+' '+backend+' repeat '+repeat+' case '+index+': '+Math.round(durationMs)+'ms '+JSON.stringify(check));
                  }
                }catch(e){run.error=String(e);console.error(run.error);}finally{worker.terminate();}
                runs.push(run);
              }
              const comparisons=[];
              if(runs.length===2&&runs.every(r=>!r.error))for(let i=0;i<runs[0].cases.length;i++)comparisons.push(compareEntityContractRecords(runs[1].cases[i].records,runs[0].cases[i].records));
              return {profile,gpu,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated,runs,comparisons};
            }''',{'profile':profile,'entry':entry,'reference':reference,'repeats':args.repeats,'debug':args.debug,'onlyBackend':args.backend})
            result['browser']=browser.version
            (OUT/(profile+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
            browser.close()
            assert all(not r.get('error') and not r.get('conformanceError') and r['conformance']['pass'] for r in result['runs']),result
            assert all(c['check']['pass'] for r in result['runs'] for c in r['cases'])
            assert all(c['pass'] for c in result['comparisons'])
finally:server.shutdown()
