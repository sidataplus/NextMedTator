"""Real-model queue pause, checkpoint/reload, resume, retry and report workflow."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2];OUT=Path(os.environ.get('NMT_QUEUE_OUTPUT',ROOT/'temp/browser-validation/resumable-queue'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_QUEUE_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,service_workers='block')
    page=context.new_page();page.set_default_timeout(30000);expect.set_options(timeout=30000);page.on('dialog',lambda d:d.accept())
    errors=[];network=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:network.append(r.url))
    try:
        response=page.goto(URL);headers=response.all_headers();expect(page.locator('#start-screen')).to_be_hidden();page.get_by_test_id('assist-practice-p10').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        assert not any('nmt-models.sidata.plus' in u or 'huggingface.co' in u for u in network),'Unrequested model download'
        notes=json.loads((ROOT/'work/p10-export.json').read_text(encoding='utf-8'))['native']
        page.evaluate("notes=>{const v=app_hotpot.vpp;v.$data.anns=[];for(const [i,n] of notes.entries()){const a=v.add_sample_txt_as_ann(n.text);a._filename='queue-'+i+'.txt.xml';}v.set_ann_idx(0);}",notes)
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work/p10.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        page.get_by_text('Batch analysis · 0 selected',exact=True).click();page.get_by_test_id('assist-select-all').click()
        page.get_by_test_id('assist-execution').select_option('wasm')
        page.get_by_text('Local recovery & backups',exact=True).click();page.get_by_test_id('assist-recovery-enable').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        page.get_by_test_id('assist-analyze-selected').click()
        page.wait_for_function("()=>document.querySelector('nextmedtator-assist').assist.batchQueue?.notes.some(n=>n.status==='completed')",timeout=600000)
        page.get_by_test_id('assist-pause').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        paused=page.evaluate("()=>document.querySelector('nextmedtator-assist').assist.batchQueue")
        complete=[n for n in paused['notes'] if n['status']=='completed'];assert 0<len(complete)<4
        page.get_by_test_id('assist-select-unfinished').click()
        assert page.evaluate("document.querySelector('nextmedtator-assist').assist.selected.size")==4-len(complete)
        page.get_by_test_id('assist-checkpoint').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        expect(page.get_by_test_id('assist-recovery-status')).to_contain_text('Local checkpoint verified')
        saved_id=page.evaluate("document.querySelector('nextmedtator-assist').assist.recoverySession.projectId")
        page.get_by_test_id('assist-batch-summary').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/'01-paused.png'))
        print('Paused and checkpointed',saved_id,flush=True)
        page.reload();expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_text('Local recovery & backups',exact=True).click();page.get_by_role('button',name='List saved corpora',exact=True).click()
        page.get_by_role('button',name='Restore corpus '+saved_id,exact=True).click()
        print('Restore requested',flush=True)
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        recovered=page.evaluate("document.querySelector('nextmedtator-assist').assist.batchQueue")
        print('Recovered queue with',sum(n['status']=='completed' for n in recovered['notes']),'completed note(s)',flush=True)
        assert [(n['key'],n.get('runId')) for n in recovered['notes'] if n['status']=='completed']==[(n['key'],n['runId']) for n in complete]
        # Recovery restores corpus and queue, not large model buffers.
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work/p10.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        page.get_by_text('Batch analysis · 0 selected',exact=True).click()
        # A settings change must refuse resume without touching completed runs.
        page.get_by_test_id('assist-mode').select_option('auto');page.get_by_test_id('assist-batch-resume').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        expect(page.get_by_test_id('assist-message')).to_contain_text('changed')
        page.get_by_test_id('assist-mode').select_option('assisted');page.get_by_test_id('assist-batch-resume').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        finished=page.evaluate("document.querySelector('nextmedtator-assist').assist.batchQueue")
        assert all(n['status']=='completed' for n in finished['notes']),finished
        assert all(next(n for n in finished['notes'] if n['key']==old['key'])['runId']==old['runId'] for old in complete)
        page.screenshot(path=str(OUT/'02-resumed.png'))
        print('Settings guard and resume passed',flush=True)
        # Inject one transient inference error at the worker boundary. Real weights
        # are still loaded; removing the fault must permit an actual model retry.
        def transient_failure(route):
            response=route.fetch()
            route.fulfill(response=response,body=response.text()+"\nconst real=self.onmessage;self.onmessage=e=>{if(e.data.task==='analyze')self.postMessage({error:'Synthetic transient failure'});else return real(e)};")
        context.route('**/onnx-worker.mjs',transient_failure)
        page.get_by_test_id('assist-select-all').click();page.get_by_test_id('assist-analyze-selected').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        failed=page.evaluate("document.querySelector('nextmedtator-assist').assist.batchQueue")
        assert sum(n['status']=='failed' for n in failed['notes'])==1
        context.unroute('**/onnx-worker.mjs');page.get_by_test_id('assist-batch-retry').click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        retried=page.evaluate("document.querySelector('nextmedtator-assist').assist.batchQueue")
        assert sum(n['status']=='completed' for n in retried['notes'])==1 and sum(n['status']=='pending' for n in retried['notes'])==3
        page.get_by_test_id('assist-batch-resume').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
        with page.expect_download() as download:page.get_by_test_id('assist-batch-report').click()
        report_path=OUT/'completion-report.json';download.value.save_as(str(report_path));report=json.loads(report_path.read_text(encoding='utf-8'))
        assert report['counts']['completed']==4 and report['counts']['failed']==0
        assert sorted(n['attempts'] for n in report['notes'])==[1,1,1,2]
        assert all('text' not in n for n in report['notes'])
        page.screenshot(path=str(OUT/'03-retried.png'))
        assert not errors,errors
        receipt={'url':URL,'browser':browser.version,'assetVersion':page.evaluate("async()=> (await (await fetch('/asset-manifest.json')).json()).version"),'crossOriginIsolated':page.evaluate('crossOriginIsolated'),'coop':headers.get('cross-origin-opener-policy'),'coep':headers.get('cross-origin-embedder-policy'),'unrequestedModelDownloads':0,'checkpointReloadResume':True,'completedRunsNotReplayed':True,'settingsMismatchBlocked':True,'retryFailedOnly':True,'completionReport':True}
        (OUT/'result.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
        print('Retry and completion report passed',flush=True)
    except Exception:
        page.screenshot(path=str(OUT/'failure.png'))
        (OUT/'failure-state.json').write_text(json.dumps(page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,queue:a.batchQueue,body:a.root.innerText}}"),indent=2),encoding='utf-8')
        raise
    finally:context.close();browser.close()
