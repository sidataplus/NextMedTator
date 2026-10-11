"""Required real-weight review and portable provenance on the original annotation screen."""
from pathlib import Path
import json,os,subprocess,time,urllib.request,zipfile
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];ZIP=Path(os.environ.get('NMT_SMALL_PACKAGE','/workspace/work/gliner25-small.nmt-model.zip'));URL='http://127.0.0.1:4175/'
def run():
 assert ZIP.is_file(),'Pinned real package required; this test never skips or substitutes weights'
 server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4175'],cwd=ROOT)
 try:
  for _ in range(100):
   try:urllib.request.urlopen(URL,timeout=1).close();break
   except Exception:time.sleep(.1)
  with sync_playwright() as p:
   exe=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium');browser=p.chromium.launch(executable_path=exe if Path(exe).exists() else None,args=['--no-sandbox']);page=browser.new_page(accept_downloads=True);page.set_default_timeout(30000);expect.set_options(timeout=30000);errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
   page.goto(URL);print('Loaded legacy page',flush=True);page.wait_for_function('() => window.app_hotpot?.vpp!=null');page.evaluate('jarvis.ssclose()');page.get_by_title('Load a minimal task').click();page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for()
   name=page.evaluate('''()=>{app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;const dtd=dtd_parser.parse(['<!ENTITY name "condition_task">','<!ELEMENT condition (#PCDATA)>','<!ATTLIST condition certainty ( present | negated | possible | unknown ) #IMPLIED "unknown">'].join(String.fromCharCode(10)),'dtd');app_hotpot.set_dtd(dtd);app_hotpot.vpp.$data.dtd=dtd;const ann=app_hotpot.vpp.add_sample_txt_as_ann('Her mother has diabetes. The patient denies diabetes.');app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return ann._filename;}''')
   page.get_by_test_id('assist-mode').select_option('assisted');print('Created note '+name,flush=True);page.locator('.file-list-item-name',has_text=name).click();page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ZIP));expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded');print('Imported model',flush=True);page.get_by_test_id('assist-analyze').click();expect(page.get_by_test_id('assist-message')).not_to_contain_text('failed');expect(page.get_by_test_id('assist-suggestion')).to_have_count(2);print('Inferred legacy records',flush=True)
   page.get_by_test_id('assist-suggestion').first.get_by_test_id('assist-accept').click();page.get_by_test_id('assist-add').click();expect(page.locator('.tag-table')).to_contain_text('diabetes')
   with page.expect_download() as download:page.get_by_role('button',name='Export evidence project',exact=True).click()
   out=ROOT/'test-results/legacy-real-small.nmt.zip';download.value.save_as(str(out))
   with zipfile.ZipFile(out) as z:
    data=json.loads(z.read('project.json'));data['schema']=json.loads(z.read('schema.json'));data['runs']=json.loads(z.read('machine-runs/index.json'))
   assert list(data['schema']['families'])==['condition'],data['schema'];assert len(data['runs'])==1 and len(data['runs'][0]['records'])==2;assert data['exposure'];assert data['draft']['records'][0]['origin']['runId']==data['runs'][0]['id'],data['draft']
   page.get_by_test_id('assist-mode').select_option('blind');expect(page.get_by_test_id('assist-suggestion')).to_have_count(0);expect(page.get_by_test_id('assist-freeze')).to_have_count(0)
   assert not errors,errors;assert all(url.startswith(URL) for url in requests),requests
   (ROOT/'test-results/legacy-real-small.json').write_text(json.dumps({'realWeights':True,'loadedSchemaPreserved':True,'liveLegacyAccept':True,'portableRunExposureAndReview':True,'exposedCopyCannotFreezeIndependent':True,'requests':len(requests),'browser':browser.version},indent=2));print('Real-weight legacy acceptance and portable provenance passed');browser.close()
 finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
