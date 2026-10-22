"""Device hints, request-only verification, cancellation, and real BPSD initialization.

The cancellation test substitutes an inert verification frame; it does not solve CAPTCHA.
Real Turnstile/P10 download is separately exercised with user-approved Browser tooling.
"""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/download-ux';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_DOWNLOAD_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path())
    context=browser.new_context(viewport={'width':1600,'height':1000})
    page=context.new_page();page.set_default_timeout(60000);errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
    page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
    expect(page.get_by_test_id('assist-device')).to_contain_text('Recommended:')
    assert not any('nmt-models.sidata.plus' in u or '.onnx' in u or 'challenges.cloudflare.com' in u for u in requests)
    page.get_by_test_id('assist-practice-p10').click()
    page.get_by_test_id('assist-download-options').locator(':scope > summary').click()
    page.get_by_test_id('assist-execution').select_option('wasm')
    expect(page.get_by_test_id('assist-device')).to_contain_text('Recommended: FP32')
    page.get_by_role('button',name='Use Recommended FP32',exact=True).click()
    expect(page.get_by_test_id('assist-precision')).to_have_value('fp32')
    assert page.get_by_test_id('assist-precision').locator('option').evaluate_all('o=>o.map(x=>x.value)')==['fp32','fp16']
    assert not any('nmt-models.sidata.plus' in u for u in requests)
    page.get_by_test_id('assist-precision').select_option('fp16')
    page.get_by_test_id('assist-execution').select_option('auto')
    page.get_by_test_id('assist-device').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'recommendation.png'))
    page.route('https://nmt-models.sidata.plus/verify?*',lambda route:route.fulfill(status=200,content_type='text/html',body='<p>Inert verification frame for cancellation test.</p>',headers={'Cross-Origin-Resource-Policy':'cross-origin'}))
    page.get_by_test_id('assist-load-model').click()
    expect(page.get_by_role('dialog',name='Verify Model Download')).to_be_visible()
    page.screenshot(path=str(OUT/'verification-cancel-test.png'))
    page.get_by_role('button',name='Cancel Download',exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
    assert not page.evaluate("document.querySelector('nextmedtator-assist').assist.error")
    assert not any('/grant' in u or '.onnx' in u for u in requests)
    page.unroute('https://nmt-models.sidata.plus/verify?*')
    page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
    page.get_by_test_id('assist-more').locator(':scope > summary').click()
    if page.get_by_test_id('assist-practice').get_attribute('open') is None:page.get_by_test_id('assist-practice').locator(':scope > summary').click()
    page.get_by_test_id('assist-practice-bpsd').click()
    page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
    page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work/bpsd.nmt-model.zip'))
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=180000)
    page.get_by_test_id('assist-execution').select_option('wasm')
    page.evaluate("""()=>{window.observedStages=[];const root=document.querySelector('nextmedtator-assist').shadowRoot;new MutationObserver(()=>{const value=root.querySelector('[data-testid=loading-progress] [data-part=label]')?.textContent;if(value&&!observedStages.includes(value))observedStages.push(value);}).observe(root,{subtree:true,childList:true,characterData:true});}""")
    page.get_by_test_id('assist-analyze').click()
    expect(page.get_by_test_id('loading-progress')).to_be_visible()
    page.get_by_test_id('assist-pause').click()
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
    assert not page.evaluate("!!document.querySelector('nextmedtator-assist').assist.modelRunner.worker")
    page.get_by_test_id('assist-analyze').click()
    page.wait_for_function("()=>observedStages.some(s=>s.startsWith('Initializing WASM'))",timeout=120000)
    page.screenshot(path=str(OUT/'bpsd-initializing.png'))
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=300000)
    result=page.evaluate("""()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,backend:a.current().run?.backend,suggestions:a.current().run?.records.length,worker:!!a.modelRunner.worker,stages:observedStages,isolated:crossOriginIsolated};}""")
    assert not result['error'] and result['backend']=='wasm' and result['suggestions']>0 and not result['worker'] and result['isolated'],result
    assert any(s.startswith('Checking model compatibility') for s in result['stages']),result
    page.get_by_test_id('assist-packages').locator(':scope > summary').click()
    page.screenshot(path=str(OUT/'bpsd-complete.png'))
    assert not errors,errors
    (OUT/'report.json').write_text(json.dumps({'url':URL,'startupDownloadRequests':0,'selectionDownloadRequests':0,'verificationCancellation':True,'initializationCancellationReleasedWorker':True,**result},indent=2))
    print(json.dumps(result),flush=True);browser.close()

