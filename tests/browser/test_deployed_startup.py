"""Fresh production startup must never fetch model weights or a model catalog."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

root=Path(__file__).resolve().parents[2];out=root/'temp/browser-validation';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path());page=browser.new_page(viewport={'width':1600,'height':1000});requests=[];errors=[]
    page.on('request',lambda r:requests.append(r.url));page.on('pageerror',lambda e:errors.append(str(e)))
    response=page.goto(os.environ.get('NMT_DEPLOYED_URL','https://nmt.sidata.plus/'))
    expect(page.locator('#start-screen')).to_be_hidden()
    assert page.evaluate('crossOriginIsolated')
    page.get_by_title('Load a minimal task').click()
    # Allow delayed startup tasks to run without triggering a model action.
    page.wait_for_timeout(5000)
    assert not any('nmt-models.sidata.plus' in u or 'huggingface.co' in u or '.onnx' in u or '/models/catalog.json' in u for u in requests),requests
    assert not page.evaluate('!!document.querySelector("nextmedtator-assist").assist.model')
    assert not errors,errors
    page.screenshot(path=str(out/'deployed-first-load-no-model.png'))
    (out/'deployed-startup.json').write_text(json.dumps({'url':page.url,'browser':browser.version,'startupSplashCloses':True,'modelDownloadRequiresRequest':True,'startupModelRequests':0,'errors':errors},indent=2),encoding='utf-8')
    print('Fresh production startup: no model downloads, no catalog request, no errors',flush=True);browser.close()
