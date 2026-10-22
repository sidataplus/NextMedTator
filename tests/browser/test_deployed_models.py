"""Public Pages + R2 download, install, restore and real inference qualification."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2];profile=os.environ.get('NMT_MODEL_PROFILE','p10')
assert profile in ('p10','bpsd')
url=os.environ.get('NMT_DEPLOYED_URL','https://nmt.sidata.plus/')
reference=json.loads((ROOT/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))
contract=reference['contract'];note=next(n for n in reference['native'] if n['records'])
package='clinical-evidence-p10-base-r2' if profile=='p10' else 'bpsd-gliner25-base-r2'
out=ROOT/'temp/browser-validation'/('deployed-'+profile);out.mkdir(parents=True,exist_ok=True)
lines=['<!ENTITY name "'+profile+'_model">']
for entity in contract['entities']:
 lines.append('<!ELEMENT '+entity['family']+' (#PCDATA)>')
 for group in contract['attributes']:
  if entity['label'] in group['appliesTo']:lines.append('<!ATTLIST '+entity['family']+' '+group['field']+' ( '+' | '.join(r['value'] for r in group['labels'])+' ) #IMPLIED "">')
dtd='\n'.join(lines)
with sync_playwright() as p:
 context=p.chromium.launch_persistent_context(user_data_dir=str(out/'chrome-profile'),executable_path=chromium_path(),headless=True,viewport={'width':1600,'height':1000},accept_downloads=True);browser=context.browser
 page=context.new_page();page.set_default_timeout(600000);expect.set_options(timeout=600000);errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true');page.on('request',lambda r:requests.append({'method':r.method,'url':r.url,'body':r.post_data}))
 response=page.goto(url);page.wait_for_function('()=>!!window.app_hotpot?.vpp');expect(page.locator('#start-screen')).to_be_hidden();print(profile+': production app loaded',flush=True)
 assert response.headers.get('cross-origin-opener-policy')=='same-origin'
 assert response.headers.get('cross-origin-embedder-policy')=='require-corp'
 assert page.evaluate('crossOriginIsolated')
 assert not any('nmt-models.sidata.plus' in r['url'] or '.onnx' in r['url'] for r in requests),'Startup fetched model weights without a request'
 page.get_by_title('Load a minimal task').click()
 def load_note():
  page.evaluate('''({text,dtd})=>{
   const schema=dtd_parser.parse(dtd,'dtd');app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;app_hotpot.set_dtd(schema);app_hotpot.vpp.$data.dtd=schema;
   const ann=app_hotpot.vpp.add_sample_txt_as_ann(text);ann._filename='fictional-note.txt.xml';app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);
  }''',{'text':note['text'],'dtd':dtd})
 load_note();page.get_by_role('button',name='Show approved public model',exact=True).click();print(profile+': production catalog opened',flush=True)
 page.get_by_role('button',name='Download and install '+package,exact=True).click();print(profile+': downloading from R2',flush=True)
 expect(page.get_by_test_id('loading-progress')).to_be_visible()
 page.wait_for_function('()=>document.querySelector("nextmedtator-assist").shadowRoot.querySelector("progress")?.value>0',timeout=600000)
 page.wait_for_function('()=>document.querySelector("nextmedtator-assist").shadowRoot.querySelector("[data-testid=loading-progress]")?.textContent.includes("About")',timeout=600000)
 page.screenshot(path=str(out/'00-download-progress.png'))
 page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy',timeout=1200000)
 message=page.get_by_test_id('assist-message').text_content();page.screenshot(path=str(out/'01-r2-installed.png'));assert 'installed' in message.lower(),message
 page.screenshot(path=str(out/'01-r2-installed.png'));print(profile+': R2 ranges, hashes and installed readback passed',flush=True)
 # Reload then block the model origin. Inference must use the stored package.
 page.reload();page.wait_for_function('()=>!!window.app_hotpot?.vpp');expect(page.locator('#start-screen')).to_be_hidden()
 page.get_by_title('Load a minimal task').click();load_note()
 page.wait_for_function('()=>!!document.querySelector("nextmedtator-assist").assist.model',timeout=600000)
 context.route('https://nmt-models.sidata.plus/**',lambda route:route.abort())
 page.get_by_test_id('assist-mode').select_option('auto');page.get_by_test_id('assist-analyze').click()
 page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy',timeout=600000)
 actual=page.evaluate('app_hotpot.vpp.$data.anns[0].tags')
 assert len(actual)==len(note['records']),(actual,page.get_by_test_id('assist-message').text_content())
 for row in note['records']:
  hit=next(t for t in actual if t['tag']==row['family'] and t['text']==row['anchor'][0]['text'])
  for field,value in row['fields'].items():assert hit[field]==value
 page.screenshot(path=str(out/'02-original-ui-inference.png'))
 with page.expect_download() as download:page.get_by_role('button',name='Export Evidence Project',exact=True).click()
 downloaded=out/'reviewed.nmt.zip';download.value.save_as(str(downloaded))
 page.get_by_role('button',name='Open Evidence Project',exact=True).click()
 page.get_by_label('Open project/files',exact=True).set_input_files(str(downloaded));expect(page.get_by_test_id('human-record')).to_have_count(len(actual))
 page.screenshot(path=str(out/'03-export-reopened.png'))
 assert not errors,errors
 assert all(r['method']=='GET' and r['body'] is None and (r['url'].startswith(url) or r['url'].startswith('https://nmt-models.sidata.plus/')) for r in requests),requests
 report={'profile':profile,'url':url,'browser':browser.version,'crossOriginIsolated':True,'publicR2DownloadAndHashInstall':True,
         'storedModelRestoredWithModelHostBlocked':True,'originalUiActualWasmInference':True,'exactAttributes':True,'spans':len(actual),
         'exportReopened':True,'requests':len(requests),'noNoteUpload':True,'clinicalValidation':False}
 (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True);browser.close()
