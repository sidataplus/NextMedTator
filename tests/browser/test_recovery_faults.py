"""Real-origin recovery locks, CAS conflicts, worker cancellation and denied storage."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];URL='http://127.0.0.1:4177/'
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
   # An unavailable local WASM asset must release the project lock and must not imply persistence.
   denied_context=browser.new_context();denied_context.route('**/vendor/sqlite/sqlite3.wasm',lambda route:route.abort());denied_page=denied_context.new_page();denied_page.goto(URL)
   denied=denied_page.evaluate('''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const s=new RecoveryStore();try{await s.enable('denied-project',{consent:true});return false;}catch(e){return !s.busy&&!s.enabled&&s.release===null&&e.code==='STORAGE_UNAVAILABLE';}}''');assert denied;denied_context.close()
   result={'multiTabLock':lock,'compareAndSwapConflict':cas,'workerCancellationPreservesPreviousCheckpoint':cancelled and retained==first,'storageDenialReleasesBusyState':denied};(ROOT/'test-results/recovery-faults.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
