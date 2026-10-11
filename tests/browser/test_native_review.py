"""Capture real browser review of previously executed local native predictions."""
import json, os, pathlib, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'test-results/bpsd-screenshots';OUT.mkdir(exist_ok=True)
URL='http://127.0.0.1:4199/'
RECEIPT=pathlib.Path(os.environ['NMT_NATIVE_RECEIPT']);BUNDLE=pathlib.Path(os.environ['NMT_NATIVE_BUNDLE'])
receipt=json.loads(RECEIPT.read_text())
server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','preview','--port','4199'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(100):
  try:urllib.request.urlopen(URL,timeout=1).close();break
  except Exception:time.sleep(.1)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1800,'height':1300},accept_downloads=True)
  page=context.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'post':r.post_data}))
  page.on('dialog',lambda d:d.accept());page.goto(URL)
  page.get_by_label('Open local documents or project',exact=True).set_input_files(str(BUNDLE))
  page.get_by_test_id('source').wait_for()
  loaded=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
  assert len(loaded['documents'])==27 and sum(len(r['records']) for r in loaded['runs'])==134
  names=[n['id'] for n in receipt['notes']]
  shots=[]
  for identifier,filename in [('syn7_00007','01-loaded-synthetic-note.png'),('syn7_00014','02-bpsd-spans-attributes.png')]:
   index=names.index(identifier);page.get_by_test_id('doc-'+str(index)).click()
   source=next(n for n in receipt['notes'] if n['id']==identifier)
   count=sum(len(v) for v in source['result']['entities'].values())
   expect(page.get_by_test_id('suggestion')).to_have_count(count)
   expect(page.get_by_test_id('source')).to_have_value(source['text'])
   page.locator('aside h3',has_text=receipt['model']['repository']).scroll_into_view_if_needed()
   if filename.startswith('02'):page.get_by_test_id('suggestion').first.get_by_role('button',name='Locate',exact=True).click()
   page.evaluate('''()=>{window.scrollTo(0,0);const root=document.querySelector('nextmedtator-workspace').shadowRoot,aside=root.querySelector('aside');const heading=[...aside.querySelectorAll('h3')].find(h=>h.textContent.startsWith('na399/bpsd-gliner'));aside.scrollTop+=heading.getBoundingClientRect().top-aside.getBoundingClientRect().top-12;}''')
   page.screenshot(path=str(OUT/filename))
   shots.append({'file':filename,'note':identifier,'predictionCount':count,'inferenceLocation':'local-native','torch':receipt['runtime']['torch']})
  # Explicit human review, portable export, actual picker re-open and retained machine layer.
  page.get_by_test_id('suggestion').first.get_by_role('button',name='Accept',exact=True).click()
  expect(page.get_by_test_id('human-record')).to_have_count(1)
  with page.expect_download() as download:page.get_by_test_id('save').click()
  download.value.save_as(str(OUT/'reviewed-native.nmt.zip'))
  page.get_by_label('Open project/files',exact=True).set_input_files(str(OUT/'reviewed-native.nmt.zip'))
  page.get_by_test_id('doc-'+str(names.index('syn7_00014'))).click()
  expect(page.get_by_test_id('human-record')).to_have_count(1)
  state=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
  assert sum(len(r['records']) for r in state['runs'])==134 and len(state['draft']['records'])==1
  page.locator('aside h3',has_text=receipt['model']['repository']).scroll_into_view_if_needed()
  page.evaluate('window.scrollTo(0,0)')
  page.screenshot(path=str(OUT/'03-reviewed-export-reopened.png'))
  shots.append({'file':'03-reviewed-export-reopened.png','humanAcceptedRecords':1,'machineLayerPreserved':True})
  page.get_by_test_id('doc-'+str(names.index('syn7_00002'))).click()
  expect(page.get_by_test_id('suggestion')).to_have_count(0)
  page.locator('aside h3',has_text=receipt['model']['repository']).scroll_into_view_if_needed()
  page.evaluate('window.scrollTo(0,0)')
  page.screenshot(path=str(OUT/'04-complete-run-zero-predictions.png'))
  assert not errors,errors
  assert all(r['method']=='GET' and r['url'].startswith(URL) and not r['post'] for r in requests),requests
  report={'browser':browser.version,'model':receipt['model'],'torch':receipt['runtime']['torch'],'notes':27,'predictions':134,'browserInference':False,'nativeInferencePreviouslyExecuted':True,'loadedSourceAndSpansVerified':True,'acceptExportReopen':True,'noEgress':True,'screenshots':shots,'clinicalValidation':False}
  (OUT/'browser-review-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['model','screenshots']}))
  browser.close()
finally:server.terminate();server.wait(timeout=5)
