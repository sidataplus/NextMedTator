"""Actual storage-worker FTS5 and original document-pane retrieval, including offline."""
from pathlib import Path
import json, os, sqlite3, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]; URL='http://127.0.0.1:4187/'
FIXTURE=r'''() => {
 app_hotpot.vpp.$data.anns=[]; app_hotpot.vpp.$data.ann_idx=null;
 const notes=[['english-01.txt.xml','Metastatic breast cancer. MI HF DM AF RA. Café.'],['english-02.txt.xml','Breast pain and distant cancer. Diabetes diabetic.'],['english-03.txt.xml','History of suicide attempt. No current suicidal thoughts.'],['markup.txt.xml','Literal <img src=x onerror="window.__nmtInjected=true"> cancer text.']];
 for(let i=0;i<32;i++)notes.push(['page-'+i+'.txt.xml','Synthetic cancer example '+i]);
 for(const [name,text] of notes){const ann=app_hotpot.vpp.add_sample_txt_as_ann(text);ann._filename=name;}
 app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);
 return notes.length;
}'''
def search(page,query,mode='words'):
 page.get_by_test_id('corpus-search-mode').select_option(mode)
 page.get_by_test_id('corpus-search-input').fill(query)
 page.get_by_test_id('corpus-search-submit').click()
 expect(page.get_by_test_id('corpus-search-status')).to_contain_text('documents match',timeout=60000)
def run():
 server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4187'],cwd=ROOT)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1).close();break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   exe=Path(os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'));browser=p.chromium.launch(executable_path=str(exe) if exe.exists() else None,args=['--no-sandbox'])
   context=browser.new_context(viewport={'width':1366,'height':768},accept_downloads=True);page=context.new_page();page.set_default_timeout(30000);errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'post':r.post_data}));page.on('dialog',lambda d:d.accept())
   page.goto(URL);page.wait_for_function('() => !!window.app_hotpot?.vpp');page.evaluate('() => jarvis.ssclose()');page.get_by_title('Load a minimal task',exact=True).click();page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for();count=page.evaluate(FIXTURE)
   page.get_by_test_id('assist-collapse').click();page.get_by_test_id('corpus-search-open').click();search(page,'breast cancer','phrase');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   page.get_by_test_id('corpus-search-hit').first.click();assert page.evaluate('() => app_hotpot.codemirror.getValue()')=='Metastatic breast cancer. MI HF DM AF RA. Café.'
   assert page.evaluate('() => app_hotpot.vpp.$data.anns.every(a=>a.tags.length===0)')
   page.evaluate("() => app_hotpot.vpp.$data.anns[0].tags.push({tag:'SYMP',id:'S0',spans:'0~10',text:'Metastatic',certainty:'positive',comment:'NA'})")
   expect(page.get_by_test_id('corpus-search-hit')).to_contain_text('1 annotation')
   page.evaluate('() => app_hotpot.vpp.$data.anns[0].tags.pop()');expect(page.get_by_test_id('corpus-search-hit')).to_contain_text('0 annotations')
   assert page.evaluate('async()=> {const entries=[];for await(const [name] of (await navigator.storage.getDirectory()).entries())entries.push(name);return entries.length;}')==0
   shots=ROOT/'test-results/corpus-search';shots.mkdir(parents=True,exist_ok=True);page.wait_for_timeout(3500);page.screenshot(path=str(shots/'english-phrase-1366x768.png'))
   search(page,'diabet','prefix');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   search(page,'MI');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   search(page,'cafe');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   search(page,'"metastatic breast" OR diabet*','advanced');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(2)
   search(page,'onerror');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   assert page.evaluate('() => !window.__nmtInjected && !document.querySelector("nextmedtator-search").shadowRoot.querySelector("img,script")')
   page.get_by_test_id('corpus-search-mode').select_option('advanced');page.get_by_test_id('corpus-search-input').fill('"unfinished');page.get_by_test_id('corpus-search-submit').click();expect(page.get_by_test_id('corpus-search-status')).to_contain_text('Invalid search expression')
   search(page,'cancer');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(25);page.get_by_test_id('corpus-search-next').click();expect(page.get_by_test_id('corpus-search-hit')).to_have_count(10)
   search(page,'renal');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(0)
   page.evaluate("() => {const ann=app_hotpot.vpp.add_sample_txt_as_ann('Renal disease synthetic CANARY_NOTE_PRIVATE');ann._filename='renal.txt.xml';}");expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   page.evaluate("() => {app_hotpot.vpp.$data.anns.at(-1).text='No relevant term';}");expect(page.get_by_test_id('corpus-search-hit')).to_have_count(0)
   page.evaluate("() => {app_hotpot.vpp.$data.anns.at(-1)._filename='renal-renamed.txt.xml';}");expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   page.evaluate('() => app_hotpot.vpp.$data.anns.pop()');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(0)
   # Delay a real query, then supersede it: old answers cannot replace the current UI.
   page.evaluate("() => {const s=document.querySelector('nextmedtator-search').search,original=s.backend.search.bind(s.backend);s.backend.search=async args=>{if(args.query==='cancer')await new Promise(resolve=>setTimeout(resolve,400));return original(args);};}")
   page.get_by_test_id('corpus-search-input').fill('cancer');page.get_by_test_id('corpus-search-submit').click();page.get_by_test_id('corpus-search-input').fill('diabetes');page.get_by_test_id('corpus-search-submit').click();expect(page.get_by_test_id('corpus-search-status')).to_contain_text('1 / 36');page.wait_for_timeout(600);expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1);expect(page.get_by_test_id('corpus-search-hit')).to_contain_text('english-02')
   page.get_by_test_id('corpus-search-close').click();expect(page.locator('.file-list-item-name',has_text='english-01')).to_be_visible()
   page.get_by_test_id('assist-expand').click();page.get_by_test_id('assist-recovery-enable').click();expect(page.get_by_test_id('assist-recovery-status')).to_contain_text('verified')
   saved=page.evaluate("async()=>{const r=document.querySelector('nextmedtator-assist').assist.recoverySession;const result=await r.store.backend.search({projectId:r.projectId,query:'breast cancer',mode:'phrase'});return {total:result.total,persistent:result.persistent,health:await r.store.backend.health()};}")
   assert saved['total']==1 and saved['persistent'] and saved['health']['schemaVersion']==3
   portable=page.evaluate("async()=> Array.from(await document.querySelector('nextmedtator-assist').assist.recoverySession.exportDatabase())")
   backup=ROOT/'test-results/corpus-search.sqlite3';backup.write_bytes(bytes(portable))
   with sqlite3.connect(backup) as db:
    assert db.execute('PRAGMA user_version').fetchone()[0]==3
    assert db.execute('SELECT COUNT(*) FROM projects').fetchone()[0]==1
    assert db.execute('SELECT COUNT(*) FROM document_fts WHERE document_fts MATCH ?',('"breast cancer"',)).fetchone()[0]==1
   await_cache=page.evaluate("async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;return true;}");assert await_cache
   page.reload();page.wait_for_function('() => !!navigator.serviceWorker.controller');context.set_offline(True);page.reload();page.wait_for_function('() => !!window.app_hotpot?.vpp');page.evaluate('() => jarvis.ssclose()');page.get_by_title('Load a minimal task',exact=True).click();page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for();page.evaluate(FIXTURE);page.get_by_test_id('corpus-search-open').click();search(page,'breast cancer','phrase');expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
   assert not errors,errors;assert all(r['method']=='GET' and r['url'].startswith(URL) and 'CANARY_' not in r['url'] and not r['post'] for r in requests),requests
   report={'actualSQLiteWorkerFTS5':True,'phrasePrefixRankingAndPages':True,'shortEnglishAbbreviations':True,'safeSnippets':True,'liveAddEditRenameDelete':True,'staleQueriesDiscarded':True,'noPersistenceBeforeConsent':True,'persistentCheckpointFTS':True,'portableSQLiteFTSVerified':True,'offlineLiveSearch':True,'annotationSemanticsUnchanged':True,'browser':browser.version,'documents':count}
   (ROOT/'test-results/corpus-search.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True);browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
