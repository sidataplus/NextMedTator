"""Real GPU and forced-failure CPU recovery through Analyze/Review/Export/Reopen.

Local: imports existing work/{p10,bpsd}.nmt-model.zip into a clean browser.
--live: uses previously installed public models in the deployment test profiles.
The failure case disables only the worker's GPU adapter, never model outputs.
"""
import argparse,json,subprocess,sys,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');args=parser.parse_args()
OUT=ROOT/'temp/browser-validation'/('webgpu-live' if args.live else 'webgpu-local');OUT.mkdir(parents=True,exist_ok=True)
url='https://nmt.sidata.plus/' if args.live else 'http://127.0.0.1:4297/'
server=None
if not args.live:
    server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4297'],cwd=ROOT)
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1).close();break
        except OSError:time.sleep(.1)
try:
    with sync_playwright() as p:
        for profile,count in [('p10',2),('bpsd',5)]:
            if args.live:
                context=p.chromium.launch_persistent_context(str(ROOT/'temp/browser-validation'/('deployed-'+profile)/'chrome-profile'),executable_path=chromium_path(),headless=True,viewport={'width':1440,'height':1000},accept_downloads=True,service_workers='block')
                browser=None
            else:
                browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
                context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True,service_workers='block')
            page=context.new_page();page.set_default_timeout(180000);expect.set_options(timeout=180000)
            errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append((r.method,r.url)));page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
            page.goto(url);expect(page.locator('#start-screen')).to_be_hidden()
            assert page.evaluate('crossOriginIsolated')
            page.get_by_test_id('assist-practice-'+profile).click()
            if not args.live:
                page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/(profile+'.nmt-model.zip')))
            page.wait_for_function('()=>!!document.querySelector("nextmedtator-assist").assist.model')
            reports=[]
            for mode in ['webgpu','fallback']:
                if mode=='fallback':
                    def break_adapter(route):
                        response=route.fetch()
                        route.fulfill(response=response,body="Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>null}});\n"+response.text())
                    context.route('**/onnx-worker.mjs',break_adapter)
                    page.get_by_test_id('assist-practice-'+profile).click()
                page.get_by_test_id('assist-mode').select_option('assisted')
                started=time.perf_counter();page.get_by_test_id('assist-analyze').click()
                page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy')
                duration=time.perf_counter()-started
                expect(page.get_by_test_id('assist-suggestion')).to_have_count(count)
                expected_backend='webgpu' if mode=='webgpu' else 'wasm'
                run=page.evaluate('document.querySelector("nextmedtator-assist").assist.current().run')
                assert run['backend']==expected_backend,run
                assert bool(run['runtime'].get('fallbackReason'))==(mode=='fallback'),run['runtime']
                if profile=='bpsd' and mode=='webgpu':assert len(run['runtime']['graphTransforms'])==1
                assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==0
                # The panel can re-render once when machine exposure is recorded.
                # Scroll the current node immediately; render preserves scrollTop.
                page.get_by_test_id('assist-suggestion').first.evaluate("element=>element.scrollIntoView({block:'center'})")
                page.screenshot(path=str(OUT/(profile+'-'+mode+'-suggestions.png')))
                page.get_by_test_id('assist-accept').first.click();page.get_by_test_id('assist-add').click()
                assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==1
                with page.expect_download() as download:page.get_by_role('button',name='Export Evidence Project',exact=True).click()
                archive=OUT/(profile+'-'+mode+'.nmt.zip');download.value.save_as(str(archive))
                page.get_by_test_id('open-workspace').click();page.get_by_label('Open project/files',exact=True).set_input_files(str(archive))
                expect(page.get_by_test_id('human-record')).to_have_count(1)
                reopened=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.runs.at(-1).runtime')
                assert reopened==run['runtime'],(reopened,run['runtime'])
                page.screenshot(path=str(OUT/(profile+'-'+mode+'-reopened.png')))
                reports.append({'mode':mode,'wallSeconds':duration,'suggestions':count,'runtime':run['runtime'],'reviewExportReopen':True})
                page.get_by_role('button',name='Back to annotation',exact=True).click()
                print(profile+' '+mode+': real inference, review and provenance-preserving export/reopen passed',flush=True)
            assert not errors,errors
            assert all(method=='GET' and target.startswith(url) for method,target in requests),requests
            (OUT/(profile+'.json')).write_text(json.dumps({'profile':profile,'browser':context.browser.version,'runs':reports,'modelDownloads':0,'noNoteEgress':True},indent=2),encoding='utf-8')
            context.close()
            if browser:browser.close()
finally:
    if server:server.terminate();server.wait(timeout=5)
