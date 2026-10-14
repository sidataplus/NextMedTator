"""Real-weight bulk inference: thread limits, lazy results, fallback and bounded UI.

Run after a production build. Uses the original P10/BPSD packages in work/.
Worker instrumentation observes messages; no model outputs are substituted.
"""
import json,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation'/('bulk-live' if os.environ.get('NMT_BULK_URL') else 'bulk-resources')
OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_BULK_URL','http://127.0.0.1:4299/')
INSTRUMENT="""()=>{
 window.bulkEvents=[];
 const Original=window.Worker;
 window.Worker=class extends Original {
  constructor(url,options){super(url,options);this.inference=String(url).includes('onnx-worker');if(this.inference)this.addEventListener('message',({data})=>{if(data.result)bulkEvents.push({type:'result',ready:data.result.ready,threads:data.result.wasmThreads,backend:data.result.backend});});}
  postMessage(message,...args){if(this.inference)bulkEvents.push({type:message.task,maxThreads:message.maxThreads});return super.postMessage(message,...args);}
  terminate(){if(this.inference)bulkEvents.push({type:'terminated'});return super.terminate();}
 };
}"""

def rows(page):
    return page.evaluate("()=>[...document.querySelector('nextmedtator-assist').assist.runs.values()].map(r=>({filename:r.filename,backend:r.backend,precision:r.precision,records:r.records.map(({family,anchor,fields,score,attributeScores})=>({family,anchor,fields,score,attributeScores}))}))")

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
    reports=[]
    for profile in ['p10','bpsd']:
        context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,service_workers='block')
        context.add_init_script('('+INSTRUMENT+')()')
        page=context.new_page();page.set_default_timeout(300000);expect.set_options(timeout=300000)
        errors=[];network=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:network.append(r.url))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-'+profile).click()
        notes=json.loads((ROOT/'work'/f'{profile}-export.json').read_text(encoding='utf-8'))['native']
        # Fixture setup uses the same application API as importing text files.
        page.evaluate("notes=>{const v=app_hotpot.vpp;v.$data.anns=[];for(const [i,n] of notes.entries()){const a=v.add_sample_txt_as_ann(n.text);a._filename='synthetic-'+i+'.txt.xml';}v.set_ann_idx(0);}",notes)
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}.nmt-model.zip'))
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        page.get_by_text('Batch analysis · 0 selected',exact=True).click()
        expect(page.get_by_test_id('assist-batch-cpu')).to_have_value('auto')
        page.get_by_test_id('assist-select-all').click()
        baseline=None
        for mode in os.environ.get('NMT_BULK_MODES','low,balanced,gpu,fallback,auto-gpu,auto-fallback').split(','):
            page.get_by_test_id('assist-batch-cpu').select_option('auto' if mode.startswith('auto-') else 'balanced' if mode=='balanced' else 'low')
            page.get_by_text('Model packages',exact=True).click() if not page.get_by_test_id('assist-execution').is_visible() else None
            page.get_by_test_id('assist-execution').select_option('auto' if mode in ['gpu','fallback','auto-gpu','auto-fallback'] else 'wasm')
            if mode in ['fallback','auto-fallback']:
                def break_gpu(route):
                    response=route.fetch();route.fulfill(response=response,body="Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>null}});\n"+response.text())
                context.route('**/onnx-worker.mjs',break_gpu)
            expected_threads=page.evaluate('Math.max(1,navigator.hardwareConcurrency-1)') if mode.startswith('auto-') else 4 if mode=='balanced' else 1
            page.evaluate("()=>{window.bulkEvents=[];document.querySelector('nextmedtator-assist').assist.modelRunner.gpuFailures.clear();}")
            start=time.perf_counter();page.get_by_test_id('assist-analyze-selected').click()
            expect(page.get_by_label('Batch analysis progress',exact=True)).to_be_visible()
            page.screenshot(path=str(OUT/f'{profile}-{mode}-progress.png'))
            page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
            elapsed=time.perf_counter()-start
            state=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {error:a.error,message:a.message,workerReleased:a.modelRunner.worker===null,events:bulkEvents};}")
            assert not state['error'],state
            assert state['workerReleased']
            events=state['events'];loads=[e for e in events if e['type']=='load']
            assert len(loads)==(2 if mode in ['fallback','auto-fallback'] else 1),events
            assert all(e['maxThreads']==expected_threads for e in loads),events
            ready=[e for e in events if e.get('ready')]
            assert ready and all(e['threads']==expected_threads for e in ready),ready
            assert len([e for e in events if e['type']=='analyze'])==len(notes)
            assert len([e for e in events if e['type']=='fixtures'])==1,'Qualification should run once per successful session'
            actual=rows(page)
            assert len(actual)==len(notes) and all(r['backend']==('webgpu' if mode in ['gpu','auto-gpu'] else 'wasm') for r in actual)
            assert [len(r['records']) for r in actual]==([2,2,5,3] if profile=='p10' else [0,0,5,2])
            if baseline:
                for a,b in zip(actual,baseline):
                    assert len(a['records'])==len(b['records'])
                    for ar,br in zip(a['records'],b['records']):
                        assert all(ar[k]==br[k] for k in ['family','anchor','fields'])
                        assert abs(ar['score']-br['score'])<1e-4
            else:baseline=actual
            page.screenshot(path=str(OUT/f'{profile}-{mode}-complete.png'))
            reports.append({'profile':profile,'mode':mode,'seconds':elapsed,'notes':len(notes),'events':events,'records':[len(r['records']) for r in actual],'workerReleased':True})
            print(f'{profile} {mode}: {len(notes)} notes, {elapsed:.1f}s, actual threads {ready[-1]["threads"]}',flush=True)
            if mode in ['fallback','auto-fallback']:context.unroute('**/onnx-worker.mjs',break_gpu)
        # Enough notes to verify DOM work is bounded independently of corpus size.
        page.evaluate("()=>{const v=app_hotpot.vpp;for(let i=4;i<121;i++){const a=v.add_sample_txt_as_ann('Fictional note.');a._filename='pagination-'+i+'.txt.xml';}v.set_ann_idx(0);}")
        page.get_by_test_id('assist-select-all').click()
        docs=page.get_by_label('Documents to analyze',exact=True)
        expect(docs.get_by_role('checkbox')).to_have_count(50)
        page.get_by_role('button',name='Next notes',exact=True).click()
        expect(docs.get_by_role('checkbox')).to_have_count(50)
        page.get_by_role('button',name='Next notes',exact=True).click()
        expect(docs.get_by_role('checkbox')).to_have_count(21)
        expect(docs).to_contain_text('121 selected')
        page.get_by_test_id('assist-select-none').click()
        expect(page.get_by_test_id('assist-analyze-selected')).to_be_disabled()
        page.screenshot(path=str(OUT/f'{profile}-pagination.png'))
        assert not errors,errors
        assert all(url.startswith(URL) or url.startswith('blob:') for url in network),network
        context.close()
    suffix='-'+os.environ['NMT_BULK_MODES'].replace(',','-') if 'NMT_BULK_MODES' in os.environ else ''
    (OUT/f'results{suffix}.json').write_text(json.dumps({'browser':browser.version,'runs':reports,'noModelDownloads':True,'pagination121Notes':True},indent=2))
    browser.close()
