"""Run the same storage checks in the installed Firefox."""
import json,os
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/storage';OUT.mkdir(parents=True,exist_ok=True)
checks=Path(__file__).with_name('model_storage_checks.js').read_text(encoding='utf-8')
options=Options();options.add_argument('-headless');options.enable_bidi=True
driver=webdriver.Firefox(options=options);driver.set_script_timeout(180)
try:
    driver.get(os.environ.get('NMT_DEPLOYED_URL','http://127.0.0.1:4299/'))
    # Run in the page realm: Marionette's sandbox has different Object prototypes
    # from IndexedDB's deserialized values and fails the strict JSON contract.
    url=driver.current_url.rstrip('/')+'/storage-regression-fixture.js'
    driver.network.add_request_handler([url],lambda r:r.provide_response(status=200,headers={'Content-Type':'text/javascript'},body='('+checks+')().then(r=>window.storageResult=r,e=>window.storageResult={error:e.message,stack:e.stack});'))
    driver.execute_script('const script=document.createElement("script");script.src=arguments[0];document.head.append(script);',url)
    result=WebDriverWait(driver,180).until(lambda d:d.execute_script('return window.storageResult'))
    assert 'error' not in result,result
    result={'engine':'Installed Firefox','version':driver.capabilities['browserVersion'],**result}
    (OUT/'firefox-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(result,flush=True)
finally:driver.quit()
