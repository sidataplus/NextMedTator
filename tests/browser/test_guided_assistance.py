"""Guided setup and cross-isolation verification handoff (inert test check).

The synthetic check tests transport/cancellation; it never solves real CAPTCHA.
The real model import/inference path uses the local BPSD package without mocks.
"""
import json,os
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect,TimeoutError as PlaywrightTimeoutError
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/guided-assistance';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_GUIDED_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    results=[]
    for engine in os.environ.get('NMT_ENGINES','chromium,webkit').split(','):
        browser=getattr(p,engine).launch(**({'executable_path':chromium_path()} if engine=='chromium' else {}))
        context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.set_default_timeout(60000)
        errors=[];requests=[];request_log=[];grants=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
        context.on('request',lambda r:request_log.append({'method':r.method,'url':r.url}))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        expect(page.get_by_test_id('assist-model-source')).to_have_value('clinical-p10')
        assert page.get_by_test_id('assist-model-source').locator('option').first.get_attribute('value')=='clinical-p10'
        expect(page.get_by_test_id('assist-more')).not_to_have_attribute('open','')
        assert not any('/models/catalog.json' in u or 'nmt-models.sidata.plus' in u for u in requests)
        page.get_by_test_id('assist-practice-p10').click()
        for width,height in [(1440,1000),(1024,768)]:
            page.set_viewport_size({'width':width,'height':height})
            positions=page.evaluate("""()=>{const r=document.querySelector('nextmedtator-assist').shadowRoot,b=r.querySelector('.body');return {order:[...b.children].map(e=>e.dataset.testid),overflow:b.scrollWidth-b.clientWidth};}""")
            assert positions['order']==['assist-step-note','assist-step-model','assist-packages','assist-step-analyze','assist-more'],positions
            assert positions['overflow']<=1,positions
            page.get_by_test_id('assist-analyze').scroll_into_view_if_needed();expect(page.get_by_test_id('assist-analyze')).to_be_disabled()
        page.set_viewport_size({'width':1440,'height':1000})
        page.get_by_test_id('assist-model-source').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'{engine}-steps.png'))
        def check(route):
            nonce=parse_qs(urlparse(route.request.url).query)['nonce'][0]
            # Owned inert fixture. A button mimics only the verified-token message.
            route.fulfill(content_type='text/html',headers={'Cross-Origin-Resource-Policy':'cross-origin'},body='<button id="test">Complete test check</button><script>document.querySelector("button").onclick=()=>parent.postMessage({nonce:'+json.dumps(nonce)+',token:"synthetic-test-token"},"*")</script>')
        context.route('https://nmt-models.sidata.plus/verify?*',check)
        def grant(route):
            grants.append(route.request.post_data_json)
            route.fulfill(status=403,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body='{"error":"Test token rejected as expected"}')
        context.route('https://nmt-models.sidata.plus/grant',grant)
        page.get_by_test_id('assist-load-model').click()
        expect(page.get_by_role('dialog',name='Verify Model Download')).to_be_visible()
        with context.expect_page() as opened:page.get_by_role('button',name='Open Verification Tab').click()
        verification=opened.value;verification.wait_for_load_state()
        popup_errors=[];popup_console=[]
        verification.on('pageerror',lambda e:popup_errors.append(str(e)))
        verification.on('console',lambda m:popup_console.append(f'{m.type}: {m.text}'))
        assert not verification.evaluate('crossOriginIsolated')
        assert page.evaluate('crossOriginIsolated')
        def handoff_state():
            state={'engine':engine,'popupUrl':verification.url,'requestLog':request_log[-20:],
                   'pageErrors':errors,'popupErrors':popup_errors,'popupConsole':popup_console}
            try:state['app']=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {busy:a.busy,error:a.error,message:a.message};}")
            except Exception as error:state['appReadError']=str(error)
            try:state['popupStatus']=verification.locator('#status').inner_text(timeout=1000)
            except Exception as error:state['popupStatusError']=str(error)
            try:state['iframeUrl']=verification.locator('iframe').get_attribute('src',timeout=1000)
            except Exception as error:state['iframeUrlError']=str(error)
            try:state['iframeText']=verification.frame_locator('iframe').locator('body').inner_text(timeout=1000)
            except Exception as error:state['iframeTextError']=str(error)
            return state
        try:
            with page.expect_request(lambda r:r.url=='https://nmt-models.sidata.plus/grant' and r.method=='POST',timeout=20000) as grant_event:
                verification.frame_locator('iframe').get_by_role('button',name='Complete test check').click()
            grant_request=grant_event.value
        except PlaywrightTimeoutError as error:
            raise AssertionError('Synthetic popup token did not reach the grant endpoint: '+json.dumps(handoff_state())) from error
        payload=grant_request.post_data_json
        assert payload['token']=='synthetic-test-token',payload
        revision=payload.get('revision','')
        assert len(revision)==64 and all(c in '0123456789abcdef' for c in revision),payload
        expect(page.get_by_test_id('assist-message')).to_contain_text('verification failed')
        assert len(grants)==1 and grants[0]==payload,grants
        expect(page.get_by_role('dialog')).to_have_count(0)
        # Retry and cancel are ordinary UI paths, with no retained worker/download.
        page.get_by_test_id('assist-load-model').click();page.get_by_role('button',name='Cancel Download').click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert len(grants)==1
        page.get_by_test_id('assist-load-model').click()
        with context.expect_page() as opened:page.get_by_role('button',name='Open Verification Tab').click()
        verification=opened.value;verification.wait_for_load_state()
        verification.get_by_role('button',name='Close this tab').click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        assert not page.evaluate("document.querySelector('nextmedtator-assist').assist.error")
        assert not any('.onnx' in u for u in requests)
        assert not errors,errors
        results.append({'engine':engine,'version':browser.version,'url':URL,'P10FirstAndDefault':True,'fourSteps':True,'popupHandoff':True,'popupGrantRequest':True,'appStillIsolated':True,'retryCancel':True,'weightsRequested':False})
        if os.environ.get('NMT_INFERENCE')=='1' and engine=='chromium':
            context.unroute('https://nmt-models.sidata.plus/verify?*');context.unroute('https://nmt-models.sidata.plus/grant')
            model_results=[]
            page.on('dialog',lambda d:d.accept())
            for name in ('p10','bpsd'):
                if name=='bpsd':
                    page.get_by_test_id('assist-more').locator(':scope > summary').click()
                    practice=page.get_by_test_id('assist-practice')
                    if practice.get_attribute('open') is None:practice.locator(':scope > summary').click()
                    page.get_by_test_id('assist-practice-bpsd').click()
                packages=page.get_by_test_id('assist-packages')
                if packages.get_attribute('open') is None:packages.locator(':scope > summary').click()
                local=page.get_by_test_id('assist-local-packages')
                if local.get_attribute('open') is None:local.locator(':scope > summary').click()
                page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{name}.nmt-model.zip'))
                page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=180000)
                page.get_by_test_id('assist-analyze').click()
                page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=360000)
                result=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,backend:a.current().run?.backend,suggestions:a.current().run?.records.length,worker:!!a.modelRunner.worker};}")
                assert not result['error'] and result['suggestions']>0 and not result['worker'],result
                page.get_by_test_id('assist-accept').first.click();page.get_by_test_id('assist-add').click()
                page.wait_for_function('()=>app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags.length===1')
                page.screenshot(path=str(OUT/f'chrome-{name}-review.png'))
                result['model']=name;result['reviewWritten']=True;model_results.append(result)
                packages=page.get_by_test_id('assist-packages')
                if packages.get_attribute('open') is None:packages.locator(':scope > summary').click()
                options=page.get_by_test_id('assist-download-options')
                if options.get_attribute('open') is None:options.locator(':scope > summary').click()
                page.get_by_test_id('assist-unload-model').click()
            results[-1]['models']=model_results
        context.close();browser.close()
    (OUT/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
