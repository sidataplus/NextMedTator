"""Both real FP16 models on the checked GPU adapter; no fallback or download."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'temp/browser-validation/storage-fallback';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path());reports=[]
    for profile,count in [('p10',2),('bpsd',5)]:
        context=browser.new_context(viewport={'width':1440,'height':1050});page=context.new_page();page.set_default_timeout(360000)
        requests=[];page.on('request',lambda r:requests.append(r.url))
        page.goto(os.environ.get('NMT_DEPLOYED_URL','http://127.0.0.1:4299/'));expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-'+profile).click()
        page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}-fp16.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        page.get_by_test_id('assist-download-options').locator(':scope > summary').click()
        page.get_by_test_id('assist-execution').select_option('auto')
        print(profile+' running real WebGPU',flush=True)
        page.get_by_test_id('assist-analyze').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        result=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,backend:a.current().run?.backend,precision:a.current().run?.precision,count:a.current().run?.records.length,worker:!!a.modelRunner.worker};}")
        assert not result['error'] and result['backend']=='webgpu' and result['precision']=='fp16' and result['count']==count and not result['worker'],result
        assert not any('nmt-models' in u or '/models/catalog' in u for u in requests)
        page.screenshot(path=str(OUT/f'chrome-{profile}-real-gpu.png'))
        result.update(profile=profile,browser=browser.version);reports.append(result);print(result,flush=True);context.close()
    browser.close();(OUT/'real-gpu-report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
