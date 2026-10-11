"""Real local entity-contract package, synthetic parity corpus and offline UI flow.

All model/schema/parity artifacts are supplied outside Git via environment paths.
No native imports are used as stand-ins for browser inference.
"""
import json,os,subprocess,sys,time,threading,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'test-results/entity-contract-browser';OUT.mkdir(exist_ok=True);URL='http://127.0.0.1:4222/'
PACKAGE=Path(os.environ['NMT_ENTITY_PACKAGE']);REPORT=json.loads(Path(os.environ['NMT_ENTITY_REPORT']).read_text());CAPACITY=json.loads(Path(os.environ['NMT_ENTITY_CAPACITY']).read_text());PROJECT=Path(os.environ['NMT_ENTITY_PROJECT'])
stop=threading.Event();peaks={'totalBrowserPssKiB':0,'rendererPssKiB':0}
def memory():
 while not stop.wait(.5):
  total=0;renderer=0
  for p in Path('/proc').glob('[0-9]*'):
   try:
    if (p/'comm').read_text().strip()!='chromium':continue
    command=(p/'cmdline').read_bytes();pss=int(next(l.split()[1] for l in (p/'smaps_rollup').read_text().splitlines() if l.startswith('Pss:')));total+=pss
    if b'--type=renderer' in command:renderer=max(renderer,pss)
   except (OSError,StopIteration):pass
  peaks['totalBrowserPssKiB']=max(peaks['totalBrowserPssKiB'],total);peaks['rendererPssKiB']=max(peaks['rendererPssKiB'],renderer)
server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','preview','--port','4222'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);threading.Thread(target=memory,daemon=True).start()
try:
 for _ in range(100):
  try:urllib.request.urlopen(URL).close();break
  except Exception:time.sleep(.1)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox']);context=browser.new_context(viewport={'width':1800,'height':1300},accept_downloads=True);page=context.new_page();page.set_default_timeout(300000);expect.set_options(timeout=300000);errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append((r.method,r.url)));page.on('dialog',lambda d:d.accept());page.goto(URL)
  page.get_by_label('Open local documents or project',exact=True).set_input_files(str(PROJECT));page.get_by_test_id('source').wait_for();page.get_by_role('button',name='Models',exact=True).click()
  page.get_by_label('Import local model package').set_input_files(str(PACKAGE));expect(page.get_by_test_id('message')).to_contain_text('Entity/attribute package loaded');print('Actual entity-contract model imported',flush=True)
  expected=[*REPORT['native'],*CAPACITY['merged']]
  if os.environ.get('NMT_ENTITY_REUSE_PARITY')=='1':
   conformance=json.loads((OUT/'conformance.json').read_text());results=json.loads((OUT/'corpus-parity.json').read_text());end_result=json.loads((OUT/'attribute-end.json').read_text());assert conformance['manifestHash']==page.evaluate('document.querySelector("nextmedtator-workspace").workspace.model.manifestHash') and conformance['pass'] and end_result['pass'] and len(results['cases'])==len(expected) and all(r['pass'] for r in results['cases']);print('Reusing preserved successful parity receipts; continuing the uncompleted offline UI checks',flush=True)
  else:
   page.get_by_role('button',name='Run wasm-fp32 conformance',exact=True).click();page.wait_for_function('()=>!document.querySelector("nextmedtator-workspace").workspace.busy',timeout=600000)
   conformance=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.modelReport');assert conformance and conformance['pass'],page.get_by_test_id('message').text_content();(OUT/'conformance.json').write_text(json.dumps(conformance,indent=2));print('Real browser fixtures passed',flush=True)
   expected=[*REPORT['native'],*CAPACITY['merged']]
   results=page.evaluate('''async expected=>{
    const w=document.querySelector('nextmedtator-workspace').workspace,{schemaFromEntityContract,compareEntityContractRecords}=await import('./app/nextmedtator/entity-contract.mjs'),variant=w.model.manifest.variants[0],contract=w.model.entityContracts.get(variant.id),schema=schemaFromEntityContract(contract),rows=[];
    const started=performance.now();await w.modelRunner.analyzeBatch(w.model,variant.id,expected.map(n=>({text:n.text,schema})),{timeoutMs:600000,onResult:(actual,index)=>{const source=expected[index],checks=compareEntityContractRecords(source.records,actual.records);if(!checks.pass||actual.status!==source.status||actual.encodedTokens!==source.encodedTokens)throw Error('Exact source/browser parity failed at case '+index+': '+JSON.stringify(checks));rows.push({case:index,status:actual.status,encodedTokens:actual.encodedTokens,...checks});}});return {durationMs:performance.now()-started,cases:rows};
   }''',expected);(OUT/'corpus-parity.json').write_text(json.dumps(results,indent=2));print('Actual browser full corpus and capacity parity passed',flush=True)
   # Actual learned attribute graph beyond word 512, using its native numerical fixture.
   end_fixture=json.loads(Path(os.environ['NMT_ENTITY_END_FIXTURE']).read_text())
   end_result=page.evaluate('''async fixture=>{const w=document.querySelector('nextmedtator-workspace').workspace,{ConformanceWorker}=await import('./app/nextmedtator/model-package.mjs'),{fingerprint,sha256}=await import('./app/nextmedtator/integrity.mjs');const manifest=JSON.parse(JSON.stringify(w.model.manifest)),bytes=new TextEncoder().encode(JSON.stringify(fixture)),path='attributes-end-reference.json';manifest.files.push({path,bytes:bytes.length,sha256:await sha256(bytes),role:'fixture'});manifest.variants[0].fixtures=[path];const files=new Map(w.model.files);files.set(path,bytes);return await new ConformanceWorker().run({manifest,files,manifestHash:await fingerprint(manifest)},manifest.variants[0].id,{timeoutMs:600000});}''',end_fixture);assert end_result['pass'];(OUT/'attribute-end.json').write_text(json.dumps(end_result,indent=2))
  page.get_by_role('button',name='Install imported package for offline use',exact=True).click();page.wait_for_function('()=>!document.querySelector("nextmedtator-workspace").workspace.busy',timeout=600000);expect(page.get_by_test_id('message')).to_contain_text('installed and read-back verified')
  page.get_by_role('button',name='Privacy & storage',exact=True).click()
  page.get_by_role('button',name='Install app for offline use',exact=True).click();expect(page.get_by_test_id('message')).to_contain_text('App cache installed');page.reload();page.wait_for_function('()=>!!navigator.serviceWorker.controller');context.set_offline(True);page.reload();page.get_by_label('Open local documents or project',exact=True).set_input_files(str(PROJECT));page.get_by_test_id('source').wait_for();page.wait_for_function('()=>!!document.querySelector("nextmedtator-workspace").workspace.model');print('Offline restart restored the exact stored model and contract',flush=True)
  # Execute the normal Analyze button, accept, export and re-open user flow offline.
  native_notes=REPORT['native'];target=next(n for n in native_notes if n['records'] and len(n['records'])>1);docs=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.documents');index=next(i for i,d in enumerate(docs) if d['text']==target['text']);page.get_by_test_id('doc-'+str(index)).click()
  initial=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.runs.length');page.get_by_test_id('analysis-mode').select_option('assisted');page.get_by_test_id('analyze').click();page.wait_for_function('()=>!document.querySelector("nextmedtator-workspace").workspace.busy',timeout=600000)
  actual=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current');assert len(actual['runs'])==initial+1 and actual['runs'][-1]['runtime']['backend']=='wasm';assert actual['runs'][-1]['status']=='complete';assert len(actual['runs'][-1]['records'])==len(target['records']);assert actual['runs'][-1]['settings']['overlapPolicy']==REPORT['contract']['overlapPolicy']
  page.evaluate('''()=>{const root=document.querySelector('nextmedtator-workspace').shadowRoot,aside=root.querySelector('aside'),heading=[...aside.querySelectorAll('h3')].at(-1);aside.scrollTop+=heading.getBoundingClientRect().top-aside.getBoundingClientRect().top-12;window.scrollTo(0,0);}''')
  page.screenshot(path=str(OUT/'01-actual-browser-inference.png'))
  # Multiple historical producers remain visible; accept from the newest real WASM run.
  page.get_by_test_id('suggestion').last.get_by_role('button',name='Accept',exact=True).click();expect(page.get_by_test_id('human-record')).to_have_count(1)
  with page.expect_download() as d:page.get_by_test_id('save').click()
  d.value.save_as(str(OUT/'browser-reviewed.nmt.zip'));page.get_by_label('Open project/files',exact=True).set_input_files(str(OUT/'browser-reviewed.nmt.zip'));page.get_by_test_id('doc-'+str(index)).click();expect(page.get_by_test_id('human-record')).to_have_count(1);reopened=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current');assert any(r['runtime']['backend']=='wasm' for r in reopened['runs']);page.evaluate('''()=>{const root=document.querySelector('nextmedtator-workspace').shadowRoot,aside=root.querySelector('aside'),heading=[...aside.querySelectorAll('h3')].at(-1);aside.scrollTop+=heading.getBoundingClientRect().top-aside.getBoundingClientRect().top-12;window.scrollTo(0,0);}''');page.screenshot(path=str(OUT/'02-offline-reviewed-reopened.png'))
  assert not errors,errors;assert all(method=='GET' and url.startswith(URL) for method,url in requests),requests
  receipt={'browser':browser.version,'actualBrowserInference':True,'modelRevision':REPORT['adapter']['revision'],'sourceNativeMergedOnnxBrowserParity':True,'cases':len(expected),'capacityTokens':[n['encodedTokens'] for n in CAPACITY['merged']],'attributeBeyond512':True,'offlineStoredContractRestored':True,'offlineAnalyzeAcceptExportReopen':True,'crossOriginIsolated':page.evaluate('crossOriginIsolated'),'wasmThreads':conformance['wasmThreads'],'memory':peaks,'corpusDurationMs':results['durationMs'],'noEgress':True,'clinicalValidation':False};(OUT/'report.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt));browser.close()
finally:stop.set();server.terminate();server.wait(timeout=5)
