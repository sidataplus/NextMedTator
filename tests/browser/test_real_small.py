"""Required real-weight WASM conformance plus installed-model offline restart/review/export.

NMT_SMALL_PACKAGE points to the pinned, locally generated package. Never replace weights with fixtures.
"""
import json,os,subprocess,time,urllib.request,zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
PACKAGE=Path(os.environ.get('NMT_SMALL_PACKAGE','/workspace/work/gliner25-small.nmt-model.zip'))
URL='http://127.0.0.1:4176/'
def run():
 assert PACKAGE.is_file(),'Download and package the pinned small model first; this qualification must not skip'
 server=subprocess.Popen(['python','scripts/serve_static.py','--directory','preview','--port','4176'],cwd=ROOT)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1).close();break
   except Exception:time.sleep(.1)
  with sync_playwright() as pw:
   exe=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium');browser=pw.chromium.launch(executable_path=exe if Path(exe).exists() else None,args=['--no-sandbox'])
   context=browser.new_context(accept_downloads=True);page=context.new_page();page.set_default_timeout(180000);expect.set_options(timeout=180000);errors=[];requests=[]
   page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'body':r.post_data}))
   page.goto(URL);fixture=json.loads((ROOT/'tests/fixtures/gliner-small-card.json').read_text())
   page.get_by_label('Open local documents or project').set_input_files({'name':'public-card.txt','mimeType':'text/plain','buffer':fixture['text'].encode()})
   page.get_by_role('button',name='Export & assignments',exact=True).click()
   page.get_by_label('Start new project with schema JSON').set_input_files({'name':'schema.json','mimeType':'application/json','buffer':json.dumps(fixture['schema']).encode()})
   page.get_by_role('button',name='Models',exact=True).click();page.get_by_label('Import local model package').set_input_files(str(PACKAGE))
   expect(page.get_by_test_id('message')).to_contain_text('loaded in memory')
   page.get_by_role('button',name='Run wasm-fp32 conformance',exact=True).click()
   page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.modelReport!==null')
   report=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.modelReport')
   assert report['pass'],report
   page.get_by_role('button',name='Install imported package for offline use',exact=True).click();expect(page.get_by_test_id('message')).to_contain_text('read-back verified')
   page.get_by_role('button',name='Privacy & storage',exact=True).click();page.get_by_role('button',name='Install app for offline use',exact=True).click();expect(page.get_by_test_id('message')).to_contain_text('App cache installed')
   page.wait_for_function('() => navigator.serviceWorker.controller!==null');context.set_offline(True);page.reload();page.get_by_test_id('sample').wait_for()
   page.get_by_label('Open local documents or project').set_input_files({'name':'offline-card.txt','mimeType':'text/plain','buffer':fixture['text'].encode()})
   page.get_by_role('button',name='Export & assignments',exact=True).click();page.get_by_label('Start new project with schema JSON').set_input_files({'name':'schema.json','mimeType':'application/json','buffer':json.dumps(fixture['schema']).encode()})
   page.get_by_role('button',name='Models',exact=True).click();page.get_by_role('button',name='List installed models',exact=True).click();page.get_by_role('button',name='Use installed gliner25-small-onnx-v5',exact=True).click()
   page.get_by_role('button',name='Close panel',exact=True).click();page.get_by_test_id('analysis-mode').select_option('assisted');page.get_by_test_id('analyze').click();expect(page.get_by_test_id('suggestion')).to_have_count(4)
   for checkbox in page.get_by_role('checkbox',name='Select suggestion for group review',exact=True).all():checkbox.check()
   page.get_by_role('button',name='Accept selected suggestions',exact=True).click()
   expect(page.get_by_test_id('human-record')).to_have_count(4)
   page.get_by_role('button',name='Review completeness',exact=True).click();page.get_by_role('checkbox',name='I checked the whole document',exact=False).check();page.get_by_test_id('complete').click();page.get_by_test_id('freeze').click()
   page.get_by_role('button',name='Compare & adjudicate',exact=True).click();page.locator('.details').get_by_role('checkbox').check();page.get_by_test_id('machine-snapshot').click();page.get_by_role('button',name='Compare snapshots',exact=True).click()
   page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.comparison!==undefined');comparison=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.comparison');assert comparison['anchors']['f1']==1 and comparison['interpretation']=='disagreement-analysis-not-accuracy',comparison
   page.get_by_role('button',name='Close panel',exact=True).click()
   out=ROOT/'test-results';out.mkdir(exist_ok=True)
   with page.expect_download() as download:page.get_by_test_id('save').click()
   download.value.save_as(str(out/'real-small-offline.nmt.zip'))
   page.get_by_label('Open project/files').set_input_files(str(out/'real-small-offline.nmt.zip'));expect(page.get_by_test_id('suggestion')).to_have_count(4)
   # Independently captured official-source attribute fixture, not authored clinical truth.
   text='Her mother has diabetes. The patient denies diabetes.'
   page.get_by_label('Open project/files').set_input_files({'name':'context-fixture.txt','mimeType':'text/plain','buffer':text.encode()})
   page.get_by_test_id('analyze').click();expect(page.get_by_test_id('suggestion')).to_have_count(2)
   structured=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.runs.at(-1).records')
   assert sorted((r['anchor'][0]['start'],r['anchor'][0]['end']) for r in structured)==[(15,23),(44,52)],structured
   for record in structured:
    assert {k:record['fields'][k] for k in ['assertion','temporality','experiencer']}=={'assertion':'negated','temporality':'unknown','experiencer':'patient'},structured
   canary='NMT_REAL_PRIVATE_CANARY'
   page.get_by_label('Open project/files').set_input_files({'name':canary+'.txt','mimeType':'text/plain','buffer':('The patient denies diabetes. '+canary).encode()})
   expect(page.get_by_test_id('source')).to_have_value('The patient denies diabetes. '+canary);page.get_by_test_id('analyze').click();expect(page.get_by_test_id('message')).to_contain_text('local span suggestion')
   assert not any(canary in json.dumps(r) for r in requests),requests
   assert all(r['method']=='GET' and r['url'].startswith(URL) for r in requests),requests
   assert not errors,errors
   result={'realWeights':True,'packageBytes':PACKAGE.stat().st_size,'conformance':report,'installedModelOfflineRestart':True,'offlineInferenceReviewCompareExportReimport':True,'canaryInferenceNoEgress':True,'sourceContextAttributeFixtureExact':True,'browser':browser.version,'requests':len(requests)}
   (out/'real-small-results.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='conformance'},indent=2));context.close();browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
