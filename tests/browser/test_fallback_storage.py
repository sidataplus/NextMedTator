"""Real FP16 import -> forced GPU failure -> FP32 download -> full cache -> WASM.

Only local immutable model bytes are served; verification is disabled in the test
catalog. No CAPTCHA or production download grant is used. Inference is real.
"""
import argparse,json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/storage-fallback';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_DEPLOYED_URL','http://127.0.0.1:4299/')
parser=argparse.ArgumentParser();parser.add_argument('--engine',default='chromium',choices=['chromium','webkit']);parser.add_argument('--profile',choices=['p10','bpsd']);args=parser.parse_args()
catalog=json.loads((ROOT/'deployment/production-model-catalog.json').read_text(encoding='utf-8'))
for entry in catalog['entries']:entry['delivery'].pop('verification',None)
roots=list((ROOT/'work').glob('final-r2-*'))+list((ROOT/'work').glob('precision-r2-*'))
def artifact(route):
    revision,relative=route.request.url.split('/nextmedtator-models/')[1].split('/',1)
    path=next(root/revision/relative for root in roots if (root/revision/relative).is_file())
    headers={'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Expose-Headers':'Content-Length,Content-Range,ETag','ETag':'"'+revision+'"'}
    byte_range=route.request.headers.get('range')
    if byte_range:
        start,end=map(int,byte_range.removeprefix('bytes=').split('-'));headers['Content-Range']=f'bytes {start}-{end}/{path.stat().st_size}'
        with path.open('rb') as stream:stream.seek(start);body=stream.read(end-start+1)
        route.fulfill(status=206,headers=headers,body=body)
    else:route.fulfill(status=200,headers=headers,body=path.read_bytes())
def gpu_failure(route):
    response=route.fetch();route.fulfill(response=response,body="Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>{throw Error('Injected GPU initialization failure')}}});\n"+response.text())
with sync_playwright() as p:
    browser=getattr(p,args.engine).launch(**({'executable_path':chromium_path()} if args.engine=='chromium' else {}))
    reports=[]
    for profile in ([args.profile] if args.profile else ('p10','bpsd')):
        context=browser.new_context(viewport={'width':1440,'height':1050},service_workers='block')
        context.route('**/models/catalog.json',lambda r:r.fulfill(content_type='application/json',body=json.dumps(catalog)))
        context.route('https://nmt-models.sidata.plus/**',artifact)
        context.route('**/onnx-worker.mjs',gpu_failure)
        context.add_init_script("""
            Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>null}});
            const original=IDBObjectStore.prototype.put;window.modelWrites=0;
            IDBObjectStore.prototype.put=function(value,key){
                if(this.name==='artifacts'&&++window.modelWrites===3)throw new DOMException('Injected full disk','QuotaExceededError');
                return original.call(this,value,key);
            };
        """)
        page=context.new_page();page.set_default_timeout(60000);errors=[];requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        assert not any('nmt-models' in u or 'models/catalog' in u for u in requests)
        page.get_by_test_id('assist-practice-'+profile).click()
        print(profile+' importing FP16',flush=True)
        if args.engine=='webkit':
            page.get_by_test_id('assist-download-options').locator(':scope > summary').click()
            page.get_by_test_id('assist-precision').select_option('fp16')
            page.get_by_test_id('assist-load-model').click()
        else:
            page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}-fp16.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=360000)
        assert page.evaluate("document.querySelector('nextmedtator-assist').assist.model?.manifest.variants[0].precision")=='fp16'
        page.evaluate('window.modelWrites=0')
        print(profile+' analyzing',flush=True)
        started=time.monotonic();page.get_by_test_id('assist-analyze').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=360000)
        state=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,run:a.current().run,precision:a.model?.manifest.variants[0].precision,status:a.executionStatus,worker:!!a.modelRunner.worker,storage:a.modelStorageNotice};}")
        print(profile+' inference finished: '+state['message'],flush=True)
        assert not state['error'],state
        assert state['run']['backend']=='wasm' and state['run']['precision']=='fp32' and len(state['run']['records'])>0,state
        assert state['precision']=='fp32' and not state['worker'] and 'this session' in state['storage'],state
        assert 'Injected GPU' in state['status']['fallbackDetail'],state
        downloads=sum('nmt-models' in u for u in requests)
        assert downloads>0
        expect(page.get_by_test_id('assist-storage-notice')).to_be_visible()
        page.screenshot(path=str(OUT/f'{args.engine}-{profile}-fallback.png'))
        page.get_by_text('Why was CPU used?',exact=True).click();page.screenshot(path=str(OUT/f'{args.engine}-{profile}-reason.png'))
        first_seconds=time.monotonic()-started
        page.get_by_test_id('assist-analyze').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=360000)
        again=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,run:a.current().run,worker:!!a.modelRunner.worker};}")
        assert not again['error'] and not again['worker'],again
        normalize=lambda records:[{key:value for key,value in record.items() if key!='id'} for record in records]
        assert normalize(again['run']['records'])==normalize(state['run']['records']),'Repeat analysis changed output'
        assert sum('nmt-models' in u for u in requests)==downloads,'Repeated Analyze redownloaded the fallback'
        assert not errors,errors
        report={'engine':args.engine,'version':browser.version,'profile':profile,'firstRunSeconds':round(first_seconds,2),'suggestions':len(state['run']['records']),'sessionOnlyFallback':True,'repeatSameOutput':True,'repeatDownloads':0,'workerReleased':True,'errors':errors}
        reports.append(report);print(json.dumps(report),flush=True)
        context.close()
    browser.close();(OUT/f'{args.engine}-report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
