"""Real download, GPU inference, FP32 fallback, review/export/reopen.

Local mode serves immutable R2 bytes via Playwright routes (no output mocks).
--live downloads the same packages from the deployed R2 catalog.
"""
import argparse,json,subprocess,sys,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');parser.add_argument('--profile',choices=['p10','bpsd']);parser.add_argument('--reuse-installed',action='store_true');parser.add_argument('--choices-only',action='store_true');args=parser.parse_args()
OUT=ROOT/'temp/browser-validation'/('precision-live' if args.live else 'precision-local');OUT.mkdir(parents=True,exist_ok=True)
url='https://nmt.sidata.plus/' if args.live else 'http://127.0.0.1:4298/'
catalog=json.loads((ROOT/'deployment/production-model-catalog.json').read_text())
server=None
if not args.live:
    server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4298'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1).close();break
        except OSError:time.sleep(.1)
def artifact(route):
    target=route.request.url.split('/nextmedtator-models/')[1];revision,relative=target.split('/',1)
    roots=list((ROOT/'work').glob('final-r2-*'))+list((ROOT/'work').glob('precision-r2-*'))
    path=next(root/revision/relative for root in roots if (root/revision/relative).is_file())
    size=path.stat().st_size;headers={'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Expose-Headers':'Content-Length,Content-Range,ETag','ETag':'"'+revision+'"'}
    request_range=route.request.headers.get('range')
    if request_range:
        start,end=map(int,request_range.removeprefix('bytes=').split('-'));headers['Content-Range']=f'bytes {start}-{end}/{size}'
        with path.open('rb') as stream:stream.seek(start);body=stream.read(end-start+1)
        route.fulfill(status=206,headers=headers,body=body)
    else:route.fulfill(status=200,headers=headers,body=path.read_bytes())
try:
    with sync_playwright() as p:
        for profile in ([args.profile] if args.profile else ['p10','bpsd']):
            context=p.chromium.launch_persistent_context(str(OUT/(profile+'-chrome')),executable_path=chromium_path(),headless=True,viewport={'width':1440,'height':1050},accept_downloads=True,service_workers='block')
            if not args.live:context.route('https://nmt-models.sidata.plus/**',artifact)
            page=context.new_page();page.set_default_timeout(900000);expect.set_options(timeout=900000)
            requests=[];errors=[];page.on('request',lambda r:requests.append((r.method,r.url)));page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
            page.goto(url);expect(page.locator('#start-screen')).to_be_hidden();page.wait_for_timeout(1500)
            assert not any('/nextmedtator-models/' in target or '/models/catalog.json' in target for _,target in requests),'Startup fetched models/catalog'
            page.get_by_test_id('assist-practice-'+profile).click()
            page.get_by_role('button',name='Show approved public model',exact=True).click()
            page.get_by_test_id('assist-precision').select_option('fp16');page.wait_for_timeout(300)
            assert not any('/nextmedtator-models/' in target for _,target in requests),'Precision selection fetched weights'
            page.get_by_test_id('assist-precision').evaluate("element=>element.scrollIntoView({block:'start'})")
            page.screenshot(path=str(OUT/(profile+'-precision-choice.png')))
            if args.choices_only:context.close();continue
            if args.reuse_installed:
                page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
                page.get_by_role('button',name='List Installed Models',exact=True).click()
                page.get_by_role('button',name='Use Installed '+profile+'-fp16-r2',exact=True).click()
            else:page.get_by_role('button',name='Download and install '+profile+'-fp16-r2',exact=True).click()
            page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy')
            assert page.evaluate('document.querySelector("nextmedtator-assist").assist.model?.manifest.variants[0].precision')=='fp16'
            reports=[]
            for mode in ['fp16','fallback']:
                page.get_by_test_id('assist-practice-'+profile).click()
                page.get_by_test_id('assist-mode').select_option('assisted')
                if mode=='fallback':
                    def break_adapter(route):
                        response=route.fetch();route.fulfill(response=response,body="Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>null}});\n"+response.text())
                    context.route('**/onnx-worker.mjs',break_adapter)
                began=time.perf_counter();page.get_by_test_id('assist-analyze').click()
                page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy')
                elapsed=time.perf_counter()-began
                state=page.evaluate('()=>{const a=document.querySelector("nextmedtator-assist").assist;return {run:a.current().run,error:a.error,message:a.message};}')
                assert not state['error'],state['message']
                run=state['run'];assert run['precision']==('fp32' if mode=='fallback' else mode),run
                assert run['backend']==('webgpu' if mode=='fp16' else 'wasm'),run
                if mode=='fallback':assert run['runtime']['fallbackFrom']['precision']=='fp16' and run['runtime']['fallbackReason']=='webgpu-initialization-failed'
                expected=json.loads((ROOT/'temp/browser-validation/webgpu'/(profile+('' if mode=='fallback' else '-'+mode)+'.json')).read_text())['runs'][0]['cases'][0 if profile=='p10' else 2]['records']
                assert len(run['records'])==len(expected),(mode,run['records'],expected)
                assert len(run['records'])>0
                page.get_by_test_id('assist-suggestion').first.evaluate("element=>element.scrollIntoView({block:'center'})")
                page.screenshot(path=str(OUT/(profile+'-'+mode+'-suggestions.png')))
                page.get_by_test_id('assist-accept').first.click();page.get_by_test_id('assist-add').click()
                with page.expect_download() as download:page.get_by_role('button',name='Export Evidence Project',exact=True).click()
                archive=OUT/(profile+'-'+mode+'.nmt.zip');download.value.save_as(str(archive))
                page.get_by_test_id('open-workspace').click();page.get_by_label('Open project/files',exact=True).set_input_files(str(archive))
                expect(page.get_by_test_id('human-record')).to_have_count(1)
                reopened=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.runs.at(-1).runtime')
                assert reopened==run['runtime']
                page.screenshot(path=str(OUT/(profile+'-'+mode+'-reopened.png')))
                reports.append({'mode':mode,'wallSeconds':elapsed,'records':len(run['records']),'runtime':run['runtime'],'reviewExportReopen':True})
                page.get_by_role('button',name='Back to annotation',exact=True).click()
                print(profile+' '+mode+' passed',flush=True)
            assert not errors,errors
            assert all(method=='GET' and (target.startswith(url) or target.startswith('https://nmt-models.sidata.plus/')) for method,target in requests),'Unexpected network egress'
            (OUT/(profile+'.json')).write_text(json.dumps({'profile':profile,'browser':context.browser.version,'runs':reports,'startupModelRequests':0,'noNoteEgress':True},indent=2),encoding='utf-8')
            context.close()
finally:
    if server:server.terminate();server.wait(timeout=5)
