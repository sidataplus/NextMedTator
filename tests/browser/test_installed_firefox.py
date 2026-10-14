"""Installed Firefox: guided setup, inert verification handoff, real local inference.

Run with: uv run --locked --with selenium python tests/browser/test_installed_firefox.py
The verification fixture never solves a CAPTCHA or grants access to real artifacts.
"""
import json,os,time
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait,Select
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'temp/browser-validation/guided-assistance';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_GUIDED_URL','http://127.0.0.1:4299/')
MODEL_DIR=Path(os.environ.get('NMT_MODEL_DIR',ROOT/'work'))
DOWNLOADS=OUT/'firefox-downloads';DOWNLOADS.mkdir(parents=True,exist_ok=True)
options=Options();options.add_argument('-headless');options.enable_bidi=True
options.unhandled_prompt_behavior='accept'
options.set_preference('browser.download.folderList',2)
options.set_preference('browser.download.dir',str(DOWNLOADS.resolve()))
options.set_preference('browser.helperApps.neverAsk.saveToDisk','application/zip,application/octet-stream')
driver=webdriver.Firefox(options=options);driver.set_window_size(1440,1050);wait=WebDriverWait(driver,120)
def el(selector):return driver.find_element(By.CSS_SELECTOR,'nextmedtator-assist').shadow_root.find_element(By.CSS_SELECTOR,selector)
def testid(name):return el('[data-testid="'+name+'"]')
def click(element):driver.execute_script('arguments[0].scrollIntoView({block:"center"})',element);element.click()
def ready():wait.until(lambda d:d.execute_script("return !document.querySelector('nextmedtator-assist')?.assist.busy"))
def expand(name):
    details=testid(name)
    if not details.get_attribute('open'):click(details.find_element(By.TAG_NAME,'summary'))

def assist_button(caption):
    return next(button for button in driver.find_element(By.CSS_SELECTOR,'nextmedtator-assist').shadow_root.find_elements(By.CSS_SELECTOR,'button') if button.text.strip()==caption)
grants=[];requests=[]
def intercept(request):
    requests.append(request.url)
    if '/verify?' in request.url:
        nonce=parse_qs(urlparse(request.url).query)['nonce'][0]
        request.provide_response(status=200,headers={'Content-Type':'text/html','Cross-Origin-Resource-Policy':'cross-origin'},body='<button id="test">Complete test check</button><script>document.querySelector("button").onclick=()=>parent.postMessage({nonce:'+json.dumps(nonce)+',token:"synthetic-test-token"},"*")</script>')
    elif request.url.endswith('/grant'):
        grants.append(request.url);request.provide_response(status=403,headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body='{"error":"Test token rejected"}')
handler=driver.network.add_request_handler(['https://nmt-models.sidata.plus/**'],intercept)
try:
    driver.get(URL);wait.until(lambda d:not d.find_element(By.ID,'start-screen').is_displayed())
    assert Select(testid('assist-model-source')).first_selected_option.get_attribute('value')=='clinical-p10'
    assert Select(testid('assist-model-source')).options[0].get_attribute('value')=='clinical-p10'
    assert not requests
    click(testid('assist-practice-p10'));ready()
    for width,height in ((1440,1050),(1024,850)):
        driver.set_window_size(width,height)
        layout=driver.execute_script("const b=document.querySelector('nextmedtator-assist').shadowRoot.querySelector('.body');return {order:[...b.children].map(e=>e.dataset.testid),overflow:b.scrollWidth-b.clientWidth}")
        assert layout['order']==['assist-step-note','assist-step-model','assist-packages','assist-step-analyze','assist-more'] and layout['overflow']<=1,layout
        driver.execute_script('arguments[0].scrollIntoView({block:"center"})',testid('assist-analyze'))
        assert not testid('assist-analyze').is_enabled()
    driver.set_window_size(1440,1050)
    wait.until(lambda d:testid('assist-load-model').is_enabled())
    driver.save_screenshot(str(OUT/'firefox-installed-steps.png'))
    click(testid('assist-load-model'));wait.until(lambda d:d.find_element(By.TAG_NAME,'dialog').is_displayed())
    original=driver.current_window_handle
    click(driver.find_element(By.XPATH,'//button[text()="Open Verification Tab"]'))
    wait.until(lambda d:len(d.window_handles)==2);driver.switch_to.window(next(h for h in driver.window_handles if h!=original))
    wait.until(lambda d:d.find_elements(By.TAG_NAME,'iframe'))
    assert not driver.execute_script('return crossOriginIsolated')
    driver.switch_to.frame(driver.find_element(By.TAG_NAME,'iframe'))
    wait.until(lambda d:d.find_elements(By.ID,'test'));driver.find_element(By.ID,'test').click()
    driver.switch_to.window(original);ready()
    wait.until(lambda d:'verification failed' in testid('assist-message').text)
    assert len(grants)==1 and driver.execute_script('return crossOriginIsolated')
    click(testid('assist-load-model'));click(driver.find_element(By.XPATH,'//button[text()="Cancel Download"]'));ready()
    assert len(grants)==1 and not any('.onnx' in u for u in requests)
    click(testid('assist-load-model'));click(driver.find_element(By.XPATH,'//button[text()="Open Verification Tab"]'))
    wait.until(lambda d:len(d.window_handles)==2);driver.switch_to.window(next(h for h in driver.window_handles if h!=original))
    wait.until(lambda d:d.find_elements(By.ID,'close'));driver.find_element(By.ID,'close').click()
    driver.switch_to.window(original);ready()
    assert not driver.find_elements(By.TAG_NAME,'dialog')
    assert not driver.execute_script("return document.querySelector('nextmedtator-assist').assist.error")
    driver.network.remove_request_handler(handler)
    results={'browser':'Installed Firefox','version':driver.capabilities['browserVersion'],'url':URL,'P10FirstAndDefault':True,'popupHandoff':True,'cancellation':True,'models':[]}
    if os.environ.get('NMT_SKIP_INFERENCE')!='1':
        for name in ('p10','bpsd'):
            if name=='bpsd':
                driver.get(URL);wait.until(lambda d:not d.find_element(By.ID,'start-screen').is_displayed())
                click(testid('assist-practice-bpsd'));ready()
            Select(testid('assist-mode')).select_by_value('assisted')
            expand('assist-packages');expand('assist-local-packages')
            package=MODEL_DIR/f'{name}-fp32.nmt-model.zip'
            if not package.is_file():package=MODEL_DIR/f'{name}.nmt-model.zip'
            el('input[aria-label="Import model package into the annotation assistance panel"]').send_keys(str(package))
            ready();wait.until(lambda d:testid('assist-analyze').is_enabled())
            print(name+': imported; running real inference',flush=True)
            click(testid('assist-analyze'))
            WebDriverWait(driver,360).until(lambda d:not d.execute_script("return document.querySelector('nextmedtator-assist').assist.busy"))
            result=driver.execute_script("const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,backend:a.current().run?.backend,suggestions:a.current().run?.records.length,worker:!!a.modelRunner.worker}")
            assert not result['error'] and result['suggestions']==(2 if name=='p10' else 5) and not result['worker'],result
            assert driver.execute_script('return app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags.length')==0
            click(testid('assist-accept'));click(testid('assist-add'));ready()
            assert driver.execute_script('return app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags.length')==1
            driver.save_screenshot(str(OUT/f'firefox-installed-{name}-review.png'))
            result['model']=name;result['reviewWritten']=True;results['models'].append(result)
            print(name+': inference and review passed; exporting',flush=True)
            before=set(DOWNLOADS.glob('*.nmt.zip'))
            click(assist_button('Export Evidence Project'))
            archive=wait.until(lambda d:next((path for path in DOWNLOADS.glob('*.nmt.zip') if path not in before and not path.with_suffix(path.suffix+'.part').exists()),None))
            expand('assist-more');click(assist_button('Open Evidence Project'))
            driver.execute_script("window.__beforeReimport=document.querySelector('nextmedtator-workspace').workspace.project")
            driver.find_element(By.CSS_SELECTOR,'nextmedtator-workspace').shadow_root.find_element(By.CSS_SELECTOR,'input[aria-label="Open project/files"]').send_keys(str(archive))
            wait.until(lambda d:d.execute_script("const w=document.querySelector('nextmedtator-workspace').workspace;return !w.busy&&!w.error&&w.project!==window.__beforeReimport"))
            wait.until(lambda d:len(d.find_element(By.CSS_SELECTOR,'nextmedtator-workspace').shadow_root.find_elements(By.CSS_SELECTOR,'[data-testid="human-record"]'))==1)
            reopened=driver.execute_script("const p=document.querySelector('nextmedtator-workspace').workspace.project.current;return {records:p.draft.records.length,runs:p.runs.length,suggestions:p.runs.at(-1).records.length,backend:p.runs.at(-1).runtime.backend}")
            assert reopened=={'records':1,'runs':1,'suggestions':result['suggestions'],'backend':result['backend']},reopened
            result['exportReimport']=True;result['archive']=str(archive)
            driver.save_screenshot(str(OUT/f'firefox-installed-{name}-reopened.png'))
            workspace=driver.find_element(By.CSS_SELECTOR,'nextmedtator-workspace').shadow_root
            click(next(button for button in workspace.find_elements(By.CSS_SELECTOR,'button') if button.text.strip()=='Back to annotation'))
            (OUT/'firefox-installed-report.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
            expand('assist-packages');expand('assist-download-options');click(testid('assist-unload-model'));ready()
            assert driver.execute_script("return document.querySelector('nextmedtator-assist').assist.model===null")
            print(name+': export/reimport and model unload passed',flush=True)
    (OUT/'firefox-installed-report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
finally:driver.quit()
