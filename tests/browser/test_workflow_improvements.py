"""Real-model long notes, review/undo, on-demand model memory, disk collections."""
import json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path,open_assist_sections
from windows_process_meter import ProcessMeter

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation'/os.environ.get('NMT_WORKFLOW_OUTPUT','workflow-improvements');OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_IMPROVEMENTS_URL','http://127.0.0.1:4299/')
NOTE_COUNT=int(os.environ.get('NMT_COLLECTION_COUNT','100'));assert NOTE_COUNT>=5
STATE="""()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,busy:a.busy,model:!!a.model,worker:!!a.modelRunner.worker,projects:a.projects.size,runs:a.runs.size,queue:a.batchQueue,collection:a.collection?.id,notes:a.collection?.notes.length};}"""

def idle(page):
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy",timeout=600000)
    state=page.evaluate(STATE);assert not state['error'],state;return state

def scroll_to(page,test_id):
    for attempt in range(3):
        try:page.get_by_test_id(test_id).scroll_into_view_if_needed();return
        except Exception as error:
            if 'not attached' not in str(error) or attempt==2:raise
            page.wait_for_timeout(200)

def section(page,label):
    page.get_by_text(label,exact=True).click()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
    cdp=browser.new_browser_cdp_session();pid=next(r['id'] for r in cdp.send('SystemInfo.getProcessInfo')['processInfo'] if r['type']=='browser');meter=ProcessMeter(pid)
    reports=[]
    for profile in os.environ.get('NMT_PROFILES','p10,bpsd').split(','):
        context=browser.new_context(viewport={'width':1600,'height':1050},accept_downloads=True)
        page=context.new_page();page.set_default_timeout(300000);expect.set_options(timeout=300000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-'+profile).click()
        long_text=('Fictional note 😀.\n\n'+''.join(f'Observation {i}. She is pacing, shouting and resisting morning care. No hallucinations.\n' for i in range(60))+'\nShe is pacing, shouting and resisting morning care. No hallucinations.  ')
        page.evaluate("text=>{const v=app_hotpot.vpp;v.$data.anns=[];const n=v.add_sample_txt_as_ann(text);n._filename='long-synthetic.txt.xml';v.set_ann_idx(0);}",long_text)
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}.nmt-model.zip'));idle(page)
        page.get_by_test_id('assist-mode').select_option('assisted')
        start=time.perf_counter();page.get_by_test_id('assist-analyze').click();idle(page)
        result=page.evaluate("""()=>{const a=document.querySelector('nextmedtator-assist').assist,r=a.current().run,p=r.project.current.runs.find(x=>x.id===r.nativeRunId),text=Array.from(a.current().ann.text);return {status:r.status,backend:r.backend,records:r.records.length,windows:p.windows.length,coverage:p.coverage,offsetsExact:r.records.every(x=>x.anchor.every(s=>text.slice(s.start,s.end).join('')===s.text)),lastAnchor:Math.max(...r.records.map(r=>r.anchor[0].end)),length:text.length};}""")
        print(profile+' long result: '+json.dumps(result),flush=True)
        assert result['status']=='complete' and result['windows']>1 and result['offsetsExact'] and result['records']>0,result
        assert result['coverage']==[[0,result['length']]] and result['lastAnchor']>result['length']*.8,result
        assert page.get_by_test_id('assist-suggestion').count()<=20
        scroll_to(page,'assist-review-controls')
        page.screenshot(path=str(OUT/f'{profile}-long-note.png'))
        print(profile+': long-note inference passed',flush=True)
        # Individual and group undo must preserve original predictions and native tags.
        page.get_by_test_id('assist-reject').first.click();idle(page)
        page.get_by_test_id('assist-review-undo').click();idle(page)
        page.get_by_test_id('assist-accept').first.click()
        page.get_by_test_id('assist-add').click();idle(page)
        assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==1
        page.get_by_test_id('assist-review-undo').click();idle(page)
        assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==0
        page.get_by_test_id('assist-apply-all').click();idle(page)
        # Apply All applies the suggestions at or above the run's Minimum Score (the model preset).
        assert page.evaluate("()=>{const r=document.querySelector('nextmedtator-assist').assist.current().run;return app_hotpot.vpp.$data.anns[0].tags.length===r.records.filter(x=>!(x.score<r.minScore)).length&&r.records.filter(x=>!(x.score<r.minScore)).length>0}")
        page.get_by_test_id('assist-review-undo').click();idle(page)
        assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==0
        assert page.evaluate('Object.keys(app_hotpot.vpp.hint_dict).length')==0
        page.get_by_test_id('assist-review-controls').focus();page.keyboard.press('Alt+r');idle(page)
        page.get_by_label('Filter suggestions by status').select_option('rejected')
        expect(page.get_by_test_id('assist-suggestion')).to_have_count(1)
        page.get_by_test_id('assist-review-undo').click();idle(page)
        expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
        page.get_by_label('Filter suggestions by status').select_option('all')
        open_assist_sections(page,'packages','download-options')
        # One package readback test also checks installed-on-disk versus loaded-in-RAM.
        if profile=='p10':page.get_by_role('button',name='Install for Offline Use',exact=True).click();idle(page)
        page.screenshot(path=str(OUT/f'{profile}-model-manager.png'))
        before_unload=meter.mark()
        page.get_by_test_id('assist-unload-model').click();assert not page.evaluate(STATE)['model']
        assert not page.evaluate(STATE)['worker']
        page.wait_for_timeout(30000);after_unload=meter.mark()
        if profile=='p10':
            page.get_by_test_id('assist-local-packages').locator(':scope > summary').click()
            page.get_by_role('button',name='List Installed Models',exact=True).click();idle(page)
            page.get_by_role('button',name='Use Installed ',exact=False).click();idle(page)
        else:
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}.nmt-model.zip'));idle(page)
        open_assist_sections(page,'more','collections')
        files=[{'name':f'{profile}-collection-{i:03}.txt','mimeType':'text/plain','buffer':('Fictional note. The patient has fever. She was agitated and wandered at night. '+str(i)).encode()} for i in range(NOTE_COUNT)]
        page.get_by_test_id('assist-collection-import').set_input_files(files);idle(page)
        assert page.evaluate(STATE)['notes']==NOTE_COUNT
        scroll_to(page,'assist-collection-memory')
        page.screenshot(path=str(OUT/f'{profile}-collection-import.png'))
        open_assist_sections(page,'batch')
        page.get_by_test_id('assist-collection-open-note').first.click();idle(page)
        page.get_by_test_id('assist-select-all').click()
        page.get_by_test_id('assist-analyze-selected').click()
        page.wait_for_function("()=>document.querySelector('nextmedtator-assist').assist.batchQueue?.notes.filter(n=>n.status==='completed').length>=3")
        page.get_by_test_id('assist-pause').click();idle(page)
        paused=page.evaluate(STATE);assert paused['queue']['state']=='paused' and not paused['worker'],paused
        collection_id=paused['collection'];completed=[n['runId'] for n in paused['queue']['notes'] if n['status']=='completed']
        page.reload();expect(page.locator('#start-screen')).to_be_hidden()
        # Reload must not materialize cached weights or start any inference.
        assert not page.evaluate(STATE)['model']
        open_assist_sections(page,'more','collections');page.get_by_test_id('assist-collection-list').click();idle(page)
        page.get_by_test_id('assist-collection-restore').click();idle(page)
        assert page.evaluate(STATE)['collection']==collection_id
        open_assist_sections(page,'packages','local-packages')
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}.nmt-model.zip'));idle(page)
        # Restore the queue's explicit review mode before resuming.
        page.get_by_label('Review mode').select_option(page.evaluate("document.querySelector('nextmedtator-assist').assist.batchQueue.settings.mode"))
        open_assist_sections(page,'batch')
        page.get_by_test_id('assist-batch-resume').click();idle(page)
        final=page.evaluate(STATE)
        assert all(n['status']=='completed' for n in final['queue']['notes']),final
        assert [n['runId'] for n in final['queue']['notes'] if n['runId'] in completed]==completed
        assert final['projects']<=1 and final['runs']<=1 and not final['worker'],final
        assert page.evaluate('app_hotpot.vpp.$data.anns.length')<=1
        page.get_by_test_id('assist-collection-open-note').first.click();idle(page)
        assert page.evaluate("()=>!!document.querySelector('nextmedtator-assist').assist.current().run")
        scroll_to(page,'assist-batch-resume')
        page.screenshot(path=str(OUT/f'{profile}-collection-complete.png'))
        page.wait_for_timeout(5000);after_complete=meter.mark()
        assert not errors,errors
        reports.append({'model':profile,'longNote':result,'workflowSeconds':time.perf_counter()-start,'memory':{'beforeUnload':before_unload,'afterUnload30s':after_unload,'afterCompletion5s':after_complete},'measurementErrors':meter.errors,'collectionNotes':NOTE_COUNT,'pauseAndResume':True,'completedRunIdsPreserved':True,'noteHistoriesResident':final['projects'],'workerReleased':True,'errors':errors})
        print(profile+f': long notes, review undo, unload and {NOTE_COUNT}-note disk queue passed',flush=True)
        (OUT/f'{profile}-results.json').write_text(json.dumps({'browser':browser.version,'url':URL,**reports[-1]},indent=2),encoding='utf-8')
        context.close()
    (OUT/'results.json').write_text(json.dumps({'browser':browser.version,'url':URL,'runs':reports},indent=2),encoding='utf-8');meter.stop();browser.close()
