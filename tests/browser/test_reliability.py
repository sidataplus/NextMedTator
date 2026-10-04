"""Import/recovery and source-bound inference regressions; no model downloads.

Successful inference uses the existing tiny synthetic ONNX fixture. Only delivery
is delayed; failure/cancellation cases explicitly inject worker errors.
"""
from pathlib import Path
import json, os, subprocess, sys, time, traceback, urllib.request
from playwright.sync_api import sync_playwright, expect
from gliner_worker_fixture import package_bytes, NOTE

ROOT=Path(__file__).resolve().parents[2]
URL='http://127.0.0.1:4188/'

def workspace(page, mode='assisted'):
    page.evaluate('''async ({bytes,text,mode})=>{
        const {EvidenceWorkspace}=await import('/app/nextmedtator/ui.mjs');
        const {ReviewProject}=await import('/app/nextmedtator/project.mjs');
        const {sourceDocument}=await import('/app/nextmedtator/integrity.mjs');
        const {importModelPackage}=await import('/app/nextmedtator/model-package.mjs');
        const host=document.createElement('nextmedtator-workspace');document.body.append(host);
        window.w=new EvidenceWorkspace(host,{startOpen:true});
        const docs=await Promise.all(['A','B'].map(id=>sourceDocument(id,new TextEncoder().encode(text))));
        await w.adopt(await ReviewProject.create(docs,{id:'test',version:'1',families:{condition:{fields:{concept:{type:'text'}}}}},{mode}));
        if(mode==='blind')await w.project.snapshot();
        w.model=await importModelPackage(new Uint8Array(bytes));
        w.modelReport=await w.modelRunner.run(w.model,'wasm');
        if(!w.modelReport.pass)throw Error('Fixture conformance failed');
        window.originalProject=w.project;window.originalModel=w.model;w.render();
    }''',{'bytes':list(package_bytes()),'text':NOTE,'mode':mode})

def inference(page, mode='assisted', failure=None, conformance=False, replace_project=False, unload_model=False):
    workspace(page,mode)
    page.evaluate('''({failure,conformance})=>{
        window.ready=false;window.finished=false;
        const method=conformance?'run':'analyze',original=w.modelRunner[method].bind(w.modelRunner);
        if(conformance)w.modelReport=null;
        w.modelRunner[method]=async(...args)=>{
            const result=failure?null:await original(...args);
            await new Promise(resolve=>{window.release=resolve;window.ready=true;});
            if(failure)throw Error(failure);
            return result;
        };
        window.pending=w.perform(()=>w.analyzeCurrent()).finally(()=>window.finished=true);
    }''',{'failure':failure,'conformance':conformance})
    page.wait_for_function('()=>window.ready')
    # Re-rendering during work must not change result ownership. Duplicate source
    # text makes a wrong-document result valid, so validation alone cannot catch it.
    page.evaluate('()=>{w.render();}')
    if mode!='blind':page.get_by_test_id('doc-1').click()
    if replace_project:
        page.evaluate('''async()=>{
            const {ReviewProject}=await import('/app/nextmedtator/project.mjs');
            await w.adopt(await ReviewProject.create(originalProject.current.documents,originalProject.current.schema));
        }''')
    page.evaluate('unload=>{if(unload)w.model=null;release();}',unload_model)
    page.wait_for_function('()=>window.finished')
    result=page.evaluate('''()=>({runs:originalProject.current.runs,documents:originalProject.current.documents,
        message:w.message,error:w.error,replacementRuns:w.project.current.runs,
        snapshot:originalProject.current.snapshots[0],manifestHash:originalModel.manifestHash})''')
    assert len(result['runs'])==1,result
    run=result['runs'][0]
    assert run['documentId']=='A' and run['sourceHash']==result['documents'][0]['textSha256'],result
    assert run['producer']['manifestHash']==result['manifestHash'],result
    assert run['status']==('cancelled' if failure=='Cancelled' else 'failed' if failure else 'complete'),result
    if replace_project:assert result['replacementRuns']==[],result
    if not failure:
        assert len(run['records'])==2 and all(r['documentId']=='A' for r in run['records']),result
        assert not result['error'],result
    if mode=='blind':
        assert 'Suggestions stay hidden' in result['message'],result
        expect(page.get_by_test_id('suggestion')).to_have_count(0)
        before=result['snapshot']['hash']
        page.evaluate('()=>{w.index=0;w.project.reveal();w.render();}')
        assert page.evaluate('w.project.current.snapshots[0].hash')==before
        assert page.evaluate('w.project.canSeeMachine')
        expect(page.get_by_test_id('suggestion')).to_have_count(2)

def legacy_inference(page):
    page.evaluate(r'''async ({bytes,text})=>{
        const {importModelPackage}=await import('/app/nextmedtator/model-package.mjs');
        const dtd=dtd_parser.parse('<!ENTITY name "condition_task">\n<!ELEMENT condition (#PCDATA)>','dtd');
        app_hotpot.set_dtd(dtd);app_hotpot.vpp.$data.dtd=dtd;app_hotpot.vpp.$data.anns=[];
        const ann=app_hotpot.vpp.add_sample_txt_as_ann(text);ann._filename='original.txt';app_hotpot.vpp.set_ann_idx(0);
        window.a=document.querySelector('nextmedtator-assist').assist;
        a.model=await importModelPackage(new Uint8Array(bytes));
        const original=a.modelRunner.analyzeBatch.bind(a.modelRunner);
        a.modelRunner.analyzeBatch=async(model,variant,requests,options)=>original(model,variant,requests,{...options,onResult:async(result,index)=>{
            await new Promise(resolve=>{window.release=resolve;window.ready=true;});
            await options.onResult(result,index);
        }});
        window.ready=false;window.finished=false;
        window.pending=a.perform(()=>a.analyzeDocuments([ann])).finally(()=>window.finished=true);
    }''',{'bytes':list(package_bytes()),'text':NOTE})
    page.wait_for_function('()=>window.ready')
    page.evaluate("()=>{const ann=app_hotpot.vpp.$data.anns[0];ann.text+=' Edited after submission.';ann._filename='edited.txt';release();}")
    page.wait_for_function('()=>window.finished')
    result=page.evaluate('''()=>({error:a.error,message:a.message,runs:[...a.runs.values()].map(r=>({filename:r.filename,text:r.project.current.documents[0].text,run:r.project.current.runs[0]})),currentRun:a.current().run})''')
    assert not result['error'] and len(result['runs'])==1,result
    assert result['runs'][0]['text']==NOTE and result['runs'][0]['filename']=='original.txt',result
    assert result['currentRun'] is None,result

def imports(page):
    page.get_by_title('Load a minimal task',exact=True).click()
    page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for()
    page.wait_for_function('()=>document.querySelector("nextmedtator-assist").assist.unwatch !== null')
    page.evaluate('''async()=>{window.a=document.querySelector('nextmedtator-assist').assist;await a.recoverySession.enable();}''')
    page.get_by_test_id('corpus-search-open').click()
    page.get_by_test_id('corpus-search-input').fill('zebrafixture')
    page.get_by_test_id('corpus-search-submit').click()
    expect(page.get_by_test_id('corpus-search-status')).to_contain_text('0 /')
    # Exercise the actual picker -> file read -> parser -> batch import path.
    page.evaluate('''()=>{window.showOpenFilePicker=async()=>[
        {kind:'file',name:'new.txt',getFile:async()=>new File(['zebrafixture first note'],'new.txt',{type:'text/plain'})},
        {kind:'file',name:'other.txt',getFile:async()=>new File(['second imported note'],'other.txt',{type:'text/plain'})}
    ];}''')
    page.locator('#dropzone_ann').click()
    expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
    page.get_by_test_id('corpus-search-hit').click()
    assert page.evaluate('app_hotpot.codemirror.getValue()')=='zebrafixture first note'
    page.evaluate("()=>{const ann=app_hotpot.vpp.$data.anns.find(a=>a.text.includes('zebrafixture'));ann.text='editedfixture updated note';ann._filename='renamed.txt';}")
    expect(page.get_by_test_id('corpus-search-hit')).to_have_count(0)
    page.get_by_test_id('corpus-search-input').fill('editedfixture')
    page.get_by_test_id('corpus-search-submit').click()
    expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
    expect(page.get_by_test_id('corpus-search-hit')).to_contain_text('renamed.txt')
    page.wait_for_function('()=>{const s=a.recoverySession;return !s.pending&&s.savedRevision===s.revision;}')
    checkpoint=page.evaluate('''async()=>{const s=a.recoverySession;return (await s.store.read(s.projectId)).data.extensions.legacyWorkspace.anns.map(n=>({name:n._filename,text:n.text}));}''')
    assert any(n['name']=='renamed.txt' and n['text']=='editedfixture updated note' for n in checkpoint),checkpoint
    saved_id=page.evaluate('a.recoverySession.projectId')
    page.evaluate('async()=>await a.recoverySession.disable()')
    page.reload();page.wait_for_function('()=>!!window.app_hotpot?.vpp');page.evaluate('jarvis.ssclose()')
    page.get_by_role('button',name='List saved corpora',exact=True).click()
    page.get_by_role('button',name='Restore corpus '+saved_id,exact=True).click()
    page.wait_for_function('()=>app_hotpot.vpp.$data.anns.some(a=>a._filename==="renamed.txt"&&a.text==="editedfixture updated note")')
    page.evaluate('async()=>await document.querySelector("nextmedtator-assist").assist.recoverySession.disable()')

def run():
    server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4188'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            cases={'imports-search-recovery':imports,'inference-document-switch':inference,
                'inference-conformance-switch':lambda page:inference(page,conformance=True),
                'inference-project-switch':lambda page:inference(page,replace_project=True),
                'inference-model-unload':lambda page:inference(page,unload_model=True),
                'inference-failure':lambda page:inference(page,failure='Injected runtime failure'),
                'inference-cancel':lambda page:inference(page,failure='Cancelled'),
                'blind-counts-hidden':lambda page:inference(page,mode='blind'),
                'legacy-inference-source-edit':legacy_inference}
            if sys.argv[1:]:cases={name:cases[name] for name in sys.argv[1:]}
            results=[]
            for name,case in cases.items():
                context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();page.set_default_timeout(15000)
                errors=[];requests=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'post':r.post_data}))
                page.on('dialog',lambda d:d.accept())
                try:
                    page.goto(URL);page.wait_for_function('()=>!!window.app_hotpot?.vpp');page.evaluate('jarvis.ssclose()')
                    case(page)
                    assert not errors,errors
                    assert all(r['method']=='GET' and r['url'].startswith(URL) and not r['post'] for r in requests),requests
                    results.append({'name':name,'pass':True})
                except Exception as error:
                    state=page.evaluate('''()=>{const a=document.querySelector('nextmedtator-assist')?.assist;return {message:a?.message,recovery:a?.recoverySession.status,notes:app_hotpot.vpp.$data.anns.map(n=>({name:n._filename,text:n.text.slice(0,80)}))};}''')
                    results.append({'name':name,'pass':False,'error':str(error),'state':state,'trace':traceback.format_exc()})
                finally:context.close()
            report={'browser':browser.version,'syntheticWeightsOnly':True,'cases':results}
            (ROOT/'test-results').mkdir(exist_ok=True)
            (ROOT/'test-results/reliability.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report,indent=2));browser.close()
            assert all(r['pass'] for r in results),'Reliability regressions failed'
    finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':run()
