"""Source-edit guards in both static views; fixture lineage only, no inference claim."""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
results=[]
for directory,port,prefix in [('preview',4202,'workspace'),('dist',4203,'assist')]:
 server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory',directory,'--port',str(port)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  url=f'http://127.0.0.1:{port}/'
  for _ in range(100):
   try:urllib.request.urlopen(url).close();break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox']);page=browser.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
   if prefix=='workspace':page.get_by_test_id('sample').click();page.get_by_role('button',name='Models',exact=True).click()
   else:
    page.wait_for_function('window.app_hotpot?.vpp && window.jarvis')
    page.evaluate('jarvis.ssclose()')
    page.locator('#start-screen').wait_for(state='hidden')
    page.get_by_title('Load a minimal task').click();page.get_by_test_id('assist-analyze').wait_for()
   page.evaluate('''prefix=>{
    window.w=document.querySelector(prefix==='workspace'?'nextmedtator-workspace':'nextmedtator-assist')[prefix==='workspace'?'workspace':'assist'];
    w.modelStore={listExisting:async()=>[]};
    w.setSelectedModel({kind:'hub-adapter',repository:'synthetic/fixture',revision:'a'.repeat(40)},{restoreInstalled:false});
    window.fixture={manifestHash:'b'.repeat(64),manifest:{id:'source-edit-fixture',version:'synthetic-test',license:{id:'LicenseRef-Synthetic-Test'},variants:[{backend:'wasm',codec:'gliner25-spans-v1',threshold:.5}],lineage:{base:{model:'synthetic/base',revision:'c'.repeat(40)},adapter:{repository:'synthetic/fixture',revision:'a'.repeat(40)}}}};
    w.adoptModel(fixture,{selectSource:true});w.render();
   }''',prefix)
   revision=page.get_by_test_id(prefix+'-model-revision');revision.fill('d'*40)
   expect(page.get_by_test_id(prefix+'-model-status')).to_contain_text('Apply the edited model source')
   assert page.evaluate('!!w.selectionDraft')
   guard=page.evaluate('''async prefix=>{try{await (prefix==='workspace'?w.analyzeCurrent():w.analyzeDocuments(w.chosenDocuments(false)));return false;}catch(e){return e.message.includes('pending model source');}}''',prefix)
   assert guard
   page.evaluate('w.render()');expect(revision).to_have_value('d'*40)
   # Loading the same source explicitly clears both an edited form and a changed mode.
   page.evaluate('w.adoptModel(fixture,{selectSource:true});w.render()')
   assert page.evaluate('w.selectionDraft===null')
   page.get_by_test_id(prefix+'-model-source').select_option('local-adapter')
   page.evaluate('w.adoptModel(fixture,{selectSource:true});w.render()')
   expect(page.get_by_test_id(prefix+'-model-source')).to_have_value('custom-huggingface')
   page.get_by_test_id(prefix+'-model-source').select_option('local-adapter')
   page.get_by_test_id(prefix+'-model-local-files').set_input_files(str(ROOT/'tests/browser/fixtures/local-adapter'))
   assert page.evaluate('w.selectionDraft.files.length===2')
   page.get_by_role('button',name='Use local adapter files',exact=True).click()
   assert page.evaluate('w.selectionDraft===null && w.modelSelection.kind==="local-adapter"')
   # Selecting new files in the already-applied local mode must become pending again.
   page.get_by_test_id(prefix+'-model-local-files').set_input_files(str(ROOT/'tests/browser/fixtures/local-adapter'))
   assert page.evaluate('!!w.selectionDraft')
   expect(page.get_by_test_id(prefix+'-model-status')).to_contain_text('Apply the edited model source')
   assert errors==[],errors
   results.append({'view':prefix,'sameModeHubEditGuard':True,'sameModeLocalEditGuard':True,'sameSourceExplicitLoadResetsDraft':True,'draftSurvivesRender':True})
   browser.close()
 finally:server.terminate();server.wait(timeout=5)
(ROOT/'test-results/model-source-edits.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
