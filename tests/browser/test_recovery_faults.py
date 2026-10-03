"""Real-origin recovery locks, CAS conflicts, worker cancellation and denied storage."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];URL='http://127.0.0.1:4177/'
def check_concurrent_v2_migration(context,a,b,expected_hash):
 # Test-only worker downgrades the actual OPFS schema while preserving its checkpoint.
 fixture='''import sqliteInit from '/vendor/sqlite/index.mjs';
 self.onmessage=async()=>{let db;try{
  const sqlite=await sqliteInit({print:()=>{},printErr:()=>{},locateFile:name=>new URL('/vendor/sqlite/'+name,self.location.href).href});
  db=new sqlite.oo1.OpfsDb('/nextmedtator-v2.sqlite3','c');
  db.exec('BEGIN IMMEDIATE');
  for(const name of ['documents_fts_insert','documents_fts_delete','documents_fts_update'])db.exec('DROP TRIGGER '+name);
  db.exec('DROP TABLE document_fts; DROP VIEW document_search_content; PRAGMA user_version=2; COMMIT;');
  db.close();db=null;self.postMessage({version:2});
 }catch(error){db?.close();self.postMessage({error:String(error)});}};'''
 context.route('**/test-fixtures/v2-storage-worker.mjs',lambda route:route.fulfill(status=200,content_type='text/javascript',headers={'Cross-Origin-Embedder-Policy':'require-corp'},body=fixture))
 assert a.evaluate('''()=>new Promise((resolve,reject)=>{const w=new Worker('/test-fixtures/v2-storage-worker.mjs',{type:'module'});w.onmessage=({data})=>{w.terminate();data.error?reject(new Error(data.error)):resolve(data.version);};w.onerror=e=>{w.terminate();reject(new Error(e.message));};w.postMessage({});})''')==2
 # Hold the production write lock. All four first requests must wait, including
 # read-only operations, before any worker opens/migrates the v2 database.
 a.evaluate('''async()=>{await new Promise(resolve=>{window.heldMigrationLock=navigator.locks.request('nextmedtator-sqlite-write-v2',()=>new Promise(release=>{window.releaseMigrationLock=release;resolve();}));});}''')
 start='''async names=>{const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');window.migrationClients=names.map(()=>new StorageBackend());window.migrationDone=false;window.migrationResults=Promise.all(names.map((name,i)=>{const client=migrationClients[i];return name==='read'?client.read('conflict-project'):name==='search'?client.search({projectId:'conflict-project',query:'diabetes'}):client[name]();})).then(values=>{window.migrationDone=true;return values;});}'''
 try:
  a.evaluate(start,['health','read']);b.evaluate(start,['list','search'])
  a.evaluate('''async()=>{const deadline=performance.now()+10000;while(performance.now()<deadline){const locks=await navigator.locks.query();if(locks.pending.filter(l=>l.name==='nextmedtator-sqlite-write-v2').length===4)return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('First requests did not acquire the migration lock');}''')
  assert not a.evaluate('migrationDone') and not b.evaluate('migrationDone')
  assert b.evaluate('''async()=>{const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');const client=new StorageBackend({memory:true});try{return !(await client.health()).persistent;}finally{client.close();}}''')
 finally:
  a.evaluate('async()=>{releaseMigrationLock();await heldMigrationLock;}')
 health,read=a.evaluate('async()=>await migrationResults');listed,search=b.evaluate('async()=>await migrationResults')
 assert health['schemaVersion']==3 and health['persistent']
 assert read['hash']==expected_hash
 assert any(row['id']=='conflict-project' for row in listed)
 assert search['total']==2 and search['persistent']
 # A subsequent write must succeed: initialization must not nest the same lock.
 updated=a.evaluate('''async hash=>{const client=migrationClients[0],old=await client.read('conflict-project');const updated=await client.checkpoint({...old.data,actor:'after-migration'},hash);return updated===(await client.read('conflict-project')).hash;}''',expected_hash)
 assert updated
 for page in [a,b]:page.evaluate('migrationClients.forEach(client=>client.close())')
 context.unroute('**/test-fixtures/v2-storage-worker.mjs')
 return True

def run():
 (ROOT/'test-results').mkdir(exist_ok=True)
 server=subprocess.Popen(['python','scripts/serve_static.py','--directory','preview','--port','4177'],cwd=ROOT)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1).close();break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   exe=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium');browser=p.chromium.launch(executable_path=exe if Path(exe).exists() else None,args=['--no-sandbox']);context=browser.new_context();a=context.new_page();b=context.new_page();a.goto(URL);b.goto(URL)
   setup='''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const {demoProject}=await import('/app/nextmedtator/samples.mjs');window.store=new RecoveryStore();window.project=await demoProject();await store.enable('conflict-project',{consent:true});window.projectData={...project.current,id:'conflict-project'};await store.checkpoint(projectData);return store.expected;}'''
   first=a.evaluate(setup)
   lock=b.evaluate('''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const s=new RecoveryStore();try{await s.enable('conflict-project',{consent:true});return false;}catch(e){return e.code==='TAB_CONFLICT';}}''');assert lock
   a.evaluate('store.disable()')
   cas=b.evaluate('''async()=>{const {StorageBackend}=await import('/app/nextmedtator/backend/storage-client.mjs');const s=new StorageBackend();const old=await s.read('conflict-project');try{await s.checkpoint({...old.data,actor:'stale-session'},null);return false;}catch(e){return e.code==='RECOVERY_CONFLICT'&&(await s.read('conflict-project')).hash===old.hash;}finally{s.close();}}''');assert cas
   # Terminate the actual storage worker before a queued write; the last verified checkpoint remains.
   cancelled=a.evaluate('''async hash=>{await store.enable('conflict-project',{consent:true,expectedHash:hash});const queued=store.checkpoint({...projectData,actor:'new'});store.backend.close();try{await queued;return false;}catch(e){return !store.busy&&e.code==='WORKER_CANCELLED';}finally{store.disable();}}''',first);assert cancelled
   retained=a.evaluate('async()=> (await store.read("conflict-project")).hash');assert retained==first
   a.evaluate('store.disable()')
   migrated=check_concurrent_v2_migration(context,a,b,first)
   # An unavailable local WASM asset must release the project lock and must not imply persistence.
   denied_context=browser.new_context();denied_context.route('**/vendor/sqlite/sqlite3.wasm',lambda route:route.abort());denied_page=denied_context.new_page();denied_page.goto(URL)
   denied=denied_page.evaluate('''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const s=new RecoveryStore();try{await s.enable('denied-project',{consent:true});return false;}catch(e){return !s.busy&&!s.enabled&&s.release===null&&e.code==='STORAGE_UNAVAILABLE';}}''');assert denied;denied_context.close()
   result={'multiTabLock':lock,'compareAndSwapConflict':cas,'workerCancellationPreservesPreviousCheckpoint':cancelled and retained==first,'concurrentV2MigrationAllFirstRequestsLocked':migrated,'storageDenialReleasesBusyState':denied};(ROOT/'test-results/recovery-faults.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
