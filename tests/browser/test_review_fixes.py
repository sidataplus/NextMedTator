"""PR #5 regressions: legacy recovery without OPFS and lossless WASM validation."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2];URL='http://127.0.0.1:4183/'
SEED='''async()=>{
    const {demoProject,authoredReference}=await import('/app/nextmedtator/samples.mjs');
    const {canonical,sha256}=await import('/app/nextmedtator/integrity.mjs');
    const p=await demoProject();p.transformRecords([],authoredReference(p.current.documents[0]));
    window.legacyData=p.current;window.legacyPayload=canonical(legacyData);const hash=await sha256(legacyPayload);
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nextmedtator-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({id:p.current.id,payload:legacyPayload,hash,updatedAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    return {id:p.current.id,hash,text:p.current.documents[0].text};
}'''

def run():
    (ROOT/'test-results').mkdir(exist_ok=True)
    server=subprocess.Popen(['python','scripts/serve_static.py','--directory','preview','--port','4183'],cwd=ROOT)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            def no_isolation(route):
                response=route.fetch();headers=dict(response.headers)
                headers.pop('cross-origin-opener-policy',None);headers.pop('cross-origin-embedder-policy',None)
                route.fulfill(response=response,headers=headers)
            results=[]
            for mode in ['no-cross-origin-isolation','sqlite-asset-denied']:
                context=browser.new_context(accept_downloads=True)
                if mode=='no-cross-origin-isolation':context.route(URL,no_isolation)
                else:context.route('**/vendor/sqlite/sqlite3.wasm',lambda route:route.abort())
                page=context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
                page.on('request',lambda r:requests.append(r))
                page.goto(URL);page.get_by_test_id('sample').wait_for()
                assert page.evaluate('crossOriginIsolated')==(mode!='no-cross-origin-isolation')
                fixture=page.evaluate(SEED)
                page.get_by_role('button',name='Privacy & storage',exact=True).click()
                page.get_by_role('button',name='List saved recovery projects',exact=True).click()
                expect(page.get_by_test_id('recovery-list-warning')).to_contain_text('Local database recovery is unavailable')
                page.get_by_role('button',name='Recover '+fixture['id'],exact=False).click()
                expect(page.get_by_test_id('source')).to_have_value(fixture['text'])
                expect(page.get_by_test_id('human-record')).to_have_count(2)
                expect(page.get_by_test_id('save-status')).to_contain_text('Legacy checkpoint loaded in memory')
                expect(page.get_by_test_id('save-status')).to_contain_text('Recovery OFF')
                retained=page.evaluate('''async id=>{const w=document.querySelector('nextmedtator-workspace').workspace;const old=await w.recovery.read(id,{backend:'indexeddb-legacy'});return {hash:old.hash,dirty:w.dirty,enabled:w.recovery.enabled};}''',fixture['id'])
                assert retained=={'hash':fixture['hash'],'dirty':True,'enabled':False},retained
                with page.expect_download() as download:page.get_by_test_id('save').click()
                exported=ROOT/'test-results'/('legacy-'+mode+'.nmt.zip');download.value.save_as(str(exported))
                page.get_by_label('Open project/files').set_input_files(str(exported))
                page.wait_for_function('() => !document.querySelector("nextmedtator-workspace").workspace.busy')
                same=page.evaluate('''async()=>{const {canonical}=await import('/app/nextmedtator/integrity.mjs');return canonical(document.querySelector('nextmedtator-workspace').workspace.project.current)===legacyPayload;}''')
                assert same,'Legacy export/reimport changed native identity'
                # Both stores failing must surface failure, never an empty successful listing.
                both=page.evaluate('''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const original=indexedDB.databases;indexedDB.databases=async()=>{throw new Error('Injected IndexedDB denial');};const store=new RecoveryStore();try{await store.list();return false;}catch(e){return e.code==='STORAGE_UNAVAILABLE'&&store.listWarnings.length===2;}finally{indexedDB.databases=original;store.backend.close();}}''')
                assert both
                assert not errors,errors
                assert all(r.method=='GET' and r.url.startswith(URL) and not r.post_data for r in requests)
                results.append({'mode':mode,'legacyListRestoreExportReimport':True,'originalHashRetained':True,'recoveryRemainsOff':True,'bothStoresFailHonestly':True})
                context.close()
            context=browser.new_context();page=context.new_page();page.goto(URL)
            validation=page.evaluate('''async()=>{
                const {demoProject,authoredReference}=await import('/app/nextmedtator/samples.mjs');
                const {validateProject}=await import('/app/nextmedtator/contracts.mjs');
                const p=await demoProject();p.transformRecords([],authoredReference(p.current.documents[0]));
                const probes=[r=>r.score=NaN,r=>r.score=Infinity,r=>r.score=undefined,r=>r.fields.concept=undefined];
                let rejected=0;for(const mutate of probes){const data=structuredClone(p.current);mutate(data.draft.records[0]);try{await validateProject(data);}catch{rejected++;}}
                const valid=structuredClone(p.current);valid.draft.records[0].score=null;valid.draft.records[0].fields.concept=null;await validateProject(valid);
                return {rejected,validNullableFieldsAccepted:true};
            }''')
            assert validation=={'rejected':4,'validNullableFieldsAccepted':True},validation
            partial=page.evaluate('''async()=>{
                const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const {demoProject}=await import('/app/nextmedtator/samples.mjs');
                const p=await demoProject(),store=new RecoveryStore();await store.enable(p.current.id,{consent:true});await store.checkpoint(p.current);store.disable();
                const original=indexedDB.databases;indexedDB.databases=async()=>{throw new Error('Injected IndexedDB denial');};
                try{const entries=await store.list();return entries.some(r=>r.id===p.current.id&&r.backend==='sqlite-opfs')&&store.listWarnings[0].startsWith('Legacy recovery is unavailable');}finally{indexedDB.databases=original;store.backend.close();}
            }''');assert partial
            report={'legacyFallback':results,'wasmValidation':validation,'sqliteListSurvivesLegacyFailure':True,'browser':browser.version}
            (ROOT/'test-results/review-fixes.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
    finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':run()
