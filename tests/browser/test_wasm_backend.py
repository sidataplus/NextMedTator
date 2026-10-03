"""Actual compiled Rust worker and SQLite-WASM/OPFS, migration and offline gates."""
from pathlib import Path
import json, os, sqlite3, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
URL = 'http://127.0.0.1:4181/'

def run():
    (ROOT/'test-results').mkdir(exist_ok=True)
    server = subprocess.Popen(['python','scripts/serve_static.py','--directory','preview','--port','4181'],cwd=ROOT)
    try:
        for _ in range(100):
            try: urllib.request.urlopen(URL,timeout=1).close(); break
            except Exception: time.sleep(.1)
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            context=browser.new_context(); page=context.new_page(); errors=[]; requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'post':r.post_data}))
            page.goto(URL); page.get_by_test_id('sample').click()
            assert page.evaluate('async()=> (await indexedDB.databases()).length')==0
            assert page.evaluate('async()=> {const entries=[];for await(const [name] of (await navigator.storage.getDirectory()).entries())entries.push(name);return entries.length;}')==0
            initial=page.evaluate(r'''async()=>{
                const {CoreBackend}=await import('/app/nextmedtator/backend/core-client.mjs');
                const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');
                const {demoProject,authoredReference}=await import('/app/nextmedtator/samples.mjs');
                window.core=new CoreBackend();window.backend=new StorageBackend();window.project=await demoProject();
                project.transformRecords([],authoredReference(project.current.documents[0]));
                const hash=await backend.checkpoint(project.current,null);
                const health=await backend.health(),offsets=await core.offsets('A👩‍⚕️\r\né');
                await core.validate(project.current);
                const matches=await core.search('CANARY_NOTE_PRIVATE same same','same');
                const summary=await backend.query(project.current.id,{});
                const second=await demoProject();await backend.checkpoint(second.current,null);
                const bytes=await backend.export(project.current.id);
                return {hash,id:project.current.id,second:second.current.id,health,offsets,matches,summary,exported:Array.from(bytes)};
            }''')
            assert initial['health']['persistent'] and initial['health']['backend']=='sqlite-opfs'
            assert initial['offsets']['codePointToUTF16']==[0,1,3,4,5,6,7,8,9,10]
            assert len(initial['matches'])==2 and initial['summary']['events']>0
            exported=ROOT/'test-results/wasm-project.sqlite3';exported.write_bytes(bytes(initial.pop('exported')))
            with sqlite3.connect(exported) as db:
                assert db.execute('SELECT id,hash FROM projects').fetchall()==[(initial['id'],initial['hash'])]
                assert db.execute('SELECT COUNT(*) FROM records').fetchone()[0]==2
                assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            race=page.evaluate('''async id=>{
                const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');
                const other=new StorageBackend(),before=await other.read(id);
                const results=await Promise.allSettled([backend.checkpoint({...before.data,actor:'session-a'},before.hash),other.checkpoint({...before.data,actor:'session-b'},before.hash)]);
                const after=await other.read(id);other.close();
                return {successes:results.filter(r=>r.status==='fulfilled').length,conflicts:results.filter(r=>r.status==='rejected'&&r.reason.code==='RECOVERY_CONFLICT').length,hash:after.hash};
            }''',initial['id'])
            assert race['successes']==1 and race['conflicts']==1,race
            initial['hash']=race['hash']
            page.evaluate('backend.close();core.cancel()');page.reload();page.get_by_test_id('sample').wait_for()
            durable=page.evaluate('''async id=>{const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');window.backend=new StorageBackend();return await backend.read(id);}''',initial['id'])
            assert durable['hash']==initial['hash']
            # Seed the old IDB format, then migrate through the production RecoveryStore.
            migrated=page.evaluate('''async()=>{
                const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');
                const {demoProject}=await import('/app/nextmedtator/samples.mjs');
                const {canonical,sha256}=await import('/app/nextmedtator/integrity.mjs');
                const project=await demoProject(),payload=canonical(project.current),hash=await sha256(payload);
                const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nextmedtator-recovery-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
                await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({id:project.current.id,payload,hash,updatedAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onabort=reject;});db.close();backend.close();
                window.store=new RecoveryStore();const old=await store.read(project.current.id,{backend:'indexeddb-legacy'});
                await store.enable(project.current.id,{consent:true,expectedHash:old.hash});
                const current=await store.read(project.current.id),legacy=await store.read(project.current.id,{backend:'indexeddb-legacy'}),migrated=store.migrated;
                store.disable();return {id:project.current.id,hash:current.hash,oldHash:legacy.hash,migrated};
            }''')
            assert migrated['hash']==migrated['oldHash'] and migrated['migrated']
            page.get_by_test_id('sample').click();page.get_by_role('button',name='Privacy & storage',exact=True).click()
            page.get_by_role('button',name='Install app for offline use',exact=True).click()
            page.wait_for_function('() => navigator.serviceWorker.controller !== null')
            context.set_offline(True);page.reload();page.get_by_test_id('sample').wait_for()
            offline=page.evaluate('''async id=>{
                const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');
                const {CoreBackend}=await import('/app/nextmedtator/backend/core-client.mjs');
                const backend=new StorageBackend(),core=new CoreBackend(),old=await backend.read(id);
                const project={...old.data,actor:'CANARY_ACTOR_PRIVATE'};
                const hash=await backend.checkpoint(project,old.hash);const matches=await core.search('CANARY_NOTE_PRIVATE same','same');
                const result={hash,readHash:(await backend.read(id)).hash,matches};backend.close();core.cancel();return result;
            }''',initial['id'])
            assert offline['hash']==offline['readHash'] and len(offline['matches'])==1
            assert not errors,errors
            assert all(r['method']=='GET' and r['url'].startswith(URL) and 'CANARY_' not in r['url'] and not r['post'] for r in requests),requests
            result={'actualRustWorker':True,'actualSQLiteOPFS':True,'noPersistenceBeforeConsent':True,'restartHashVerified':True,'singleProjectSQLiteExport':True,'concurrentStorageWorkersCAS':True,'legacyMigrationIdentityPreserved':True,'legacyCopyRetained':True,'offlineReadWriteAndCore':True,'networkCanariesAbsent':True,'browser':browser.version}
            (ROOT/'test-results/wasm-backend.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
    finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':run()
