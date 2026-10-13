"""Actual pinned adapter inference on this host, plus an explicit GPU attempt.

Run with NMT_MODEL_PROFILE=p10 or bpsd after its real export in work/.
Only fictional exporter notes are used. No prediction injection.
"""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = os.environ.get('NMT_MODEL_PROFILE','bpsd')
assert PROFILE in ('p10','bpsd')
OUT = ROOT/'test-results'/('requested-'+PROFILE)
OUT.mkdir(parents=True,exist_ok=True)
reference = json.loads((ROOT/'work'/(PROFILE+'-export.json')).read_text(encoding='utf-8'))
URL = 'http://127.0.0.1:4260/'
server = subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','preview','--port','4260'],cwd=ROOT)
try:
    for _ in range(100):
        try: urllib.request.urlopen(URL,timeout=1).close(); break
        except OSError: time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium_path(),headless=os.environ.get('NMT_HEADED')!='1')
        context = browser.new_context(accept_downloads=True,viewport={'width':1600,'height':1000})
        page = context.new_page(); page.set_default_timeout(600000); expect.set_options(timeout=600000)
        errors=[]; requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append((r.method,r.url)))
        page.goto(URL);page.get_by_role('button',name='Models',exact=True).click();print('Models opened',flush=True)
        page.get_by_label('Import local model package').set_input_files(str(ROOT/'work'/(PROFILE+'.nmt-model.zip')))
        expect(page.get_by_test_id('message')).to_contain_text('Entity/attribute package loaded')
        print('Imported actual '+PROFILE,flush=True)
        page.get_by_role('button',name='Run wasm-fp32 conformance',exact=True).click()
        page.wait_for_function('()=>!document.querySelector("nextmedtator-workspace").workspace.busy',timeout=600000)
        conformance=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.modelReport')
        assert conformance and conformance['pass'],page.get_by_test_id('message').text_content()
        print('WASM fixtures passed',flush=True)
        results=page.evaluate('''async expected=>{
          const w=document.querySelector('nextmedtator-workspace').workspace;
          const {schemaFromEntityContract,compareEntityContractRecords}=await import('./app/nextmedtator/entity-contract.mjs');
          const variant=w.model.manifest.variants[0],contract=w.model.entityContracts.get(variant.id),schema=schemaFromEntityContract(contract),rows=[];
          await w.modelRunner.analyzeBatch(w.model,variant.id,expected.map(n=>({text:n.text,schema})),{timeoutMs:600000,onResult:(actual,index)=>{
            const check=compareEntityContractRecords(expected[index].records,actual.records);
            if(!check.pass||actual.status!==expected[index].status)throw Error('Source parity '+index+': '+JSON.stringify(check));
            rows.push({case:index,...check,encodedTokens:actual.encodedTokens});}});
          return rows;
        }''',reference['native'])
        print('Full native/browser parity passed',flush=True)
        target=next(n for n in reference['native'] if n['records'])
        awaitable='''async text=>{
          const w=document.querySelector('nextmedtator-workspace').workspace;
          const {schemaFromEntityContract}=await import('./app/nextmedtator/entity-contract.mjs');
          const {ReviewProject}=await import('./app/nextmedtator/project.mjs');
          const {sourceDocument}=await import('./app/nextmedtator/integrity.mjs');
          const v=w.model.manifest.variants[0],schema=schemaFromEntityContract(w.model.entityContracts.get(v.id));
          await w.adopt(await ReviewProject.create([await sourceDocument('fictional-note',new TextEncoder().encode(text))],schema));
          w.applicationMode='assisted';w.render();
        }'''
        page.evaluate(awaitable,target['text'])
        page.get_by_test_id('analysis-mode').select_option('assisted');page.get_by_test_id('analyze').click()
        page.wait_for_function('()=>!document.querySelector("nextmedtator-workspace").workspace.busy',timeout=600000)
        expect(page.get_by_test_id('suggestion')).to_have_count(len(target['records']))
        page.get_by_test_id('suggestion').first.get_by_role('button',name='Accept',exact=True).click()
        with page.expect_download() as download:page.get_by_test_id('save').click()
        reviewed=OUT/'reviewed.nmt.zip';download.value.save_as(str(reviewed))
        page.get_by_label('Open project/files',exact=True).set_input_files(str(reviewed))
        expect(page.get_by_test_id('human-record')).to_have_count(1)
        print('Actual Analyze/Accept/Export/Reopen passed',flush=True)
        # Pure WebGPU session, no WASM fallback. A failure is recorded, never
        # silently advertised as a qualified GPU model.
        gpu=page.evaluate('''async()=>{
          const w=document.querySelector('nextmedtator-workspace').workspace;
          if(!navigator.gpu)return {available:false,error:'navigator.gpu unavailable'};
          const adapter=await navigator.gpu.requestAdapter();if(!adapter)return {available:false,error:'No GPU adapter'};
          const result={available:true,info:adapter.info?.toJSON?.()??{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture}};
          const ort=await import('./vendor/ort/ort.webgpu.min.mjs');ort.env.wasm.wasmPaths=new URL('./vendor/ort/',location.href).href;
          let session;try{const v=w.model.manifest.variants[0];session=await ort.InferenceSession.create(w.model.files.get(v.graphs.model),{executionProviders:['webgpu']});
            const fixture=JSON.parse(new TextDecoder().decode(w.model.files.get(v.fixtures.find(p=>p.startsWith('model-reference-')))));
            const feeds={};for(const [name,t]of Object.entries(fixture.feeds))feeds[name]=new ort.Tensor(t.type,t.type==='int64'?BigInt64Array.from(t.data,BigInt):t.type==='bool'?Uint8Array.from(t.data):Float32Array.from(t.data),t.dims);
            const start=performance.now();await session.run(feeds);return {...result,modelSessionAndRun:true,durationMs:performance.now()-start};
          }catch(e){return {...result,modelSessionAndRun:false,error:String(e)};}finally{await session?.release();}
        }''')
        (OUT/'gpu-attempt.json').write_text(json.dumps(gpu,indent=2),encoding='utf-8')
        print('WebGPU: '+json.dumps(gpu),flush=True)
        assert not errors,errors
        assert all(method=='GET' and url.startswith(URL) for method,url in requests),requests
        report={'profile':PROFILE,'browser':browser.version,'actualBrowserInference':True,'crossOriginIsolated':page.evaluate('crossOriginIsolated'),
                'conformance':conformance,'cases':results,'analyzeAcceptExportReopen':True,'webgpu':gpu,'noEgress':True,'clinicalValidation':False}
        (OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        page.screenshot(path=str(OUT/'browser.png'))
        browser.close()
finally:
    server.terminate();server.wait(timeout=5)
