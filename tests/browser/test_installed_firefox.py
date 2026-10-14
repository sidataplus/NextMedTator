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
options=Options();options.add_argument('-headless');options.enable_bidi=True
driver=webdriver.Firefox(options=options);driver.set_window_size(1440,1050);wait=WebDriverWait(driver,120)
def el(selector):return driver.find_element(By.CSS_SELECTOR,'nextmedtator-assist').shadow_root.find_element(By.CSS_SELECTOR,selector)
def testid(name):return el('[data-testid="'+name+'"]')
def click(element):driver.execute_script('arguments[0].scrollIntoView({block:"center"})',element);element.click()
def ready():wait.until(lambda d:d.execute_script("return !document.querySelector('nextmedtator-assist')?.assist.busy"))
def expand(name):
    details=testid(name)
    if not details.get_attribute('open'):click(details.find_element(By.TAG_NAME,'summary'))
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
            expand('assist-packages');expand('assist-local-packages')
            el('input[aria-label="Import model package into the annotation assistance panel"]').send_keys(str(ROOT/'work'/f'{name}.nmt-model.zip'))
            ready();wait.until(lambda d:testid('assist-analyze').is_enabled())
            click(testid('assist-analyze'))
            WebDriverWait(driver,360).until(lambda d:not d.execute_script("return document.querySelector('nextmedtator-assist').assist.busy"))
            result=driver.execute_script("const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,backend:a.current().run?.backend,suggestions:a.current().run?.records.length,worker:!!a.modelRunner.worker}")
            assert not result['error'] and result['suggestions']>0 and not result['worker'],result
            click(testid('assist-accept'));click(testid('assist-add'));ready()
            assert driver.execute_script('return app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags.length')==1
            driver.save_screenshot(str(OUT/f'firefox-installed-{name}-review.png'))
            result['model']=name;result['reviewWritten']=True;results['models'].append(result)
            (OUT/'firefox-installed-report.json').write_text(json.dumps(results,indent=2))
            expand('assist-packages');expand('assist-download-options');click(testid('assist-unload-model'));ready()
            assert driver.execute_script("return document.querySelector('nextmedtator-assist').assist.model===null")
    (OUT/'firefox-installed-report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
finally:driver.quit()
