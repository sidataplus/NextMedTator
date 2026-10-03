"""Real-origin recovery locks, CAS conflicts, quota failure and denied storage."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];URL='http://127.0.0.1:4177/'
def run():
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
   cas=b.evaluate('''async()=>{const {RecoveryStore}=await import('/app/nextmedtator/recovery.mjs');const s=new RecoveryStore();await s.enable('conflict-project',{consent:true});try{await s.checkpoint({id:'conflict-project',value:'overwrite'});return false;}catch(e){s.disable();return e.code==='RECOVERY_CONFLICT';}}''');assert cas
   quota=a.evaluate('''async hash=>{await store.enable('conflict-project',{consent:true,expectedHash:hash});const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Test quota exhaustion','QuotaExceededError');};try{await store.checkpoint({...projectData,actor:'new'});return false;}catch{return !store.busy;}finally{IDBObjectStore.prototype.put=original;store.disable();}}''',first);assert quota
   retained=a.evaluate('async()=> (await store.read("conflict-project")).hash');assert retained==first
   denied=a.evaluate('''async()=>{await store.enable('denied-project',{consent:true});const original=indexedDB.open;indexedDB.open=()=>{throw new DOMException('Denied','SecurityError');};try{await store.checkpoint({id:'denied-project'});return false;}catch{return !store.busy;}finally{indexedDB.open=original;store.disable();}}''');assert denied
   result={'multiTabLock':lock,'compareAndSwapConflict':cas,'quotaFailurePreservesPreviousCheckpoint':quota and retained==first,'storageDenialReleasesBusyState':denied};(ROOT/'test-results/recovery-faults.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
