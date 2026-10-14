"""Real FP16 reference checks, plus a labeled injected mismatch for report UX."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'temp/browser-validation/gpu-check';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_DEPLOYED_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path());reports=[]
    for profile in ('p10','bpsd'):
        context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,service_workers='block')
        page=context.new_page();page.set_default_timeout(120000);requests=[];errors=[]
        page.on('request',lambda r:requests.append(r.url));page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-'+profile).click()
        page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(Path(os.environ.get('NMT_MODEL_DIR',ROOT/'work'))/f'{profile}-fp16.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        page.get_by_test_id('assist-download-options').locator(':scope > summary').click()
        print(profile+' checking real FP16',flush=True)
        page.get_by_test_id('assist-check-gpu').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        state=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,check:a.gpuCheck,worker:!!a.modelRunner.worker,run:!!a.current().run};}")
        assert not state['error'] and state['check']['pass'] and not state['worker'] and not state['run'],state
        with page.expect_download() as saved:page.get_by_test_id('assist-save-gpu-check').click()
        path=OUT/f'{profile}-actual.json';saved.value.save_as(str(path));actual=json.loads(path.read_text(encoding='utf-8'))
        assert actual['precision']=='fp16' and len(actual['fixtures'])==5
        assert all('records' not in f or ('spans' in f['records'] and f['records']['tolerance']==0.05) for f in actual['fixtures'])
        assert 'anchor' not in json.dumps(actual) and 'fever' not in json.dumps(actual)
        page.screenshot(path=str(OUT/f'{profile}-actual.png'))
        def mismatch(route):
            response=route.fetch()
            # Only inject a synthetic failed result in this test; real inference
            # and unchanged reference checks were verified above.
            hook="const originalPost=self.postMessage.bind(self);self.postMessage=data=>{if(data.result?.results){data.result.pass=false;const row=data.result.results.find(r=>r.nativeChecks);row.pass=false;row.nativeChecks={pass:false,reason:'confidence-scores-differ',spans:2,maxScoreError:0.06,tolerance:0.05};}originalPost(data);};\n"
            route.fulfill(response=response,body=hook+response.text())
        context.route('**/onnx-worker.mjs',mismatch)
        page.get_by_test_id('assist-check-gpu').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        expect(page.get_by_test_id('assist-gpu-check-result')).to_contain_text('spans and attributes match')
        expect(page.get_by_test_id('assist-gpu-check-result')).to_contain_text('0.06000 exceeds 0.05')
        state=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,worker:!!a.modelRunner.worker,precision:a.model.manifest.variants[0].precision,check:a.gpuCheck,run:!!a.current().run};}")
        assert not state['error'] and not state['worker'] and not state['run'] and state['precision']=='fp16' and not state['check']['pass'],state
        page.screenshot(path=str(OUT/f'{profile}-injected-mismatch.png'))
        assert not any('nmt-models' in u or '/models/catalog' in u for u in requests),requests
        assert not errors,errors
        reports.append({'profile':profile,'browser':browser.version,'realFP16CheckPassed':True,'injectedMismatchReported':True,'modelRequests':0,'diagnosticDidNotAnalyzeNotes':True,'reportExport':True,'workerReleased':True})
        print(reports[-1],flush=True);context.close()
    browser.close();(OUT/'report.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
