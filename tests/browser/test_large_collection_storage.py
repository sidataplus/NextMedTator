"""10,000-note disk/queue/streaming-backup stress test; no model substitution."""
import json,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
from windows_process_meter import ProcessMeter
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'temp/browser-validation'/os.environ.get('NMT_COLLECTION_OUTPUT','large-collection');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
    cdp=browser.new_browser_cdp_session();pid=next(r['id'] for r in cdp.send('SystemInfo.getProcessInfo')['processInfo'] if r['type']=='browser');meter=ProcessMeter(pid)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(600000);page.on('dialog',lambda d:d.accept())
    page.goto('http://127.0.0.1:4299/');expect(page.locator('#start-screen')).to_be_hidden();page.get_by_test_id('assist-practice-p10').click()
    page.wait_for_timeout(1000);start=meter.mark()
    result=page.evaluate("""async()=>{
      const {CollectionStore}=await import('/app/nextmedtator/collection-store.mjs');
      const {exportCollection,importCollectionBackup}=await import('/app/nextmedtator/collection-backup.mjs');
      const {createBatchQueue,restoreBatchQueue}=await import('/app/nextmedtator/batch-queue.mjs');
      const {documentKey}=await import('/app/nextmedtator/assist.mjs');
      const a=document.querySelector('nextmedtator-assist').assist,store=a.collectionStore;
      const meta=await store.create(app_hotpot.vpp.$data.dtd,'10,000 synthetic notes');
      const files=Array.from({length:10000},(_,i)=>new File(['Fictional note '+i+'. '+'Routine synthetic background. '.repeat(30)],'note-'+String(i).padStart(5,'0')+'.txt'));
      await store.importFiles(meta,files,{keyFor:documentKey});
      const first=await store.note(meta.id,meta.notes[0]._diskKey);
      meta.queue=createBatchQueue('synthetic-storage-test',meta.notes.map(n=>({key:n._diskKey,filename:n._filename,sourceHash:n.sourceHash})));
      await store.commit(meta);meta.queue.notes[0].status='running';await store.commit(meta);
      const restored=await store.read(meta.id);const queue=restoreBatchQueue(restored.queue);
      if(queue.notes[0].status!=='pending'||queue.notes.length!==10000)throw Error('Interrupted queue was not restored');
      const stale=structuredClone(restored);await store.commit(restored);let conflict=false;try{await new CollectionStore().commit(stale);}catch(e){conflict=e.message.includes('another tab');}if(!conflict)throw Error('Lost-update guard failed');
      // Stream to an actual OPFS file, then restore through the normal parser.
      const root=await navigator.storage.getDirectory(),file=await root.getFileHandle('synthetic-collection-test.jsonl',{create:true});
      await exportCollection(store,restored,await file.createWritable());const backup=await file.getFile();
      const roundTrip=await importCollectionBackup(store,backup,{keyFor:documentKey});
      if(roundTrip.notes.length!==10000||(await store.note(roundTrip.id,roundTrip.notes[0]._diskKey)).ann.text!==first.ann.text)throw Error('Backup round trip failed');
      const before=(await store.list()).length;
      let truncated=false;try{await importCollectionBackup(store,backup.slice(0,backup.size-200),{keyFor:documentKey});}catch{truncated=true;}
      if(!truncated||(await store.list()).length!==before)throw Error('Incomplete import cleanup failed');
      await a.openCollection(meta.id,{replaceConfirmed:true});await a.openCollectionNote(meta.notes[0]._diskKey);await a.openCollectionNote(meta.notes.at(-1)._diskKey);await a.saveCollectionCurrent();a.render();
      if(a.projects.size!==1||a.runs.size||app_hotpot.vpp.$data.anns.length!==1)throw Error('Unbounded note cache: '+JSON.stringify({projects:a.projects.size,runs:a.runs.size,notes:app_hotpot.vpp.$data.anns.length}));
      const active=app_hotpot.vpp.$data.anns[0],saving=a.saveCollectionCurrent();app_hotpot.vpp.$set(active,'testMarker','edited-during-save');await saving;await new Promise(r=>setTimeout(r,2000));for(let i=0;i<100&&a.busy;i++)await new Promise(r=>setTimeout(r,100));
      if((await store.note(meta.id,active._diskKey)).ann.testMarker!=='edited-during-save')throw Error('Concurrent editor change was not checkpointed');
      await root.removeEntry('synthetic-collection-test.jsonl');
      return {notes:10000,bytes:files.reduce((n,f)=>n+f.size,0),backupBytes:backup.size,interruptedQueueRecovered:true,concurrentSaveRejected:conflict,backupRoundTrip:true,truncatedBackupRejected:true,editDuringSavePreserved:true,noteHistoriesLoaded:a.projects.size,editorNotes:app_hotpot.vpp.$data.anns.length};
    }""")
    end=meter.mark();result['resources']=meter.summarize(start,end)
    page.get_by_text('Batch Analysis (0 selected)',exact=True).click();expect(page.get_by_label('Files to analyze').get_by_role('checkbox')).to_have_count(50)
    page.get_by_test_id('assist-batch-report').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'10000-notes.png'))
    page.get_by_text('Large Collections',exact=True).click();page.get_by_test_id('assist-collection-memory').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'10000-note-storage.png'))
    meter.stop();result['measurementErrors']=meter.errors;result['browser']=browser.version
    (OUT/'results.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True);browser.close()
