"""Real adapter inference through the original MedTator annotation interface."""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2];profile=os.environ.get('NMT_MODEL_PROFILE','bpsd')
assert profile in ('p10','bpsd')
reference=json.loads((ROOT/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))
contract=reference['contract'];note=next(n for n in reference['native'] if n['records'])
out=ROOT/'test-results'/('legacy-'+profile);out.mkdir(parents=True,exist_ok=True)
lines=['<!ENTITY name "'+profile+'_model">']
for entity in contract['entities']:
    family=entity['family'];lines.append('<!ELEMENT '+family+' (#PCDATA)>')
    for group in contract['attributes']:
        if entity['label'] not in group['appliesTo']:continue
        values=[r['value'] for r in group['labels']]
        lines.append('<!ATTLIST '+family+' '+group['field']+' ( '+' | '.join(values)+' ) #IMPLIED "">')
dtd='\n'.join(lines);(out/'annotation-schema.dtd').write_text(dtd,encoding='utf-8')
url='http://127.0.0.1:4261/'
server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4261'],cwd=ROOT)
try:
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1).close();break
        except OSError:time.sleep(.1)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chromium_path());page=browser.new_page(viewport={'width':1600,'height':1000},accept_downloads=True)
        page.set_default_timeout(600000);expect.set_options(timeout=600000);errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
        page.goto(url);page.wait_for_function('()=>!!window.app_hotpot?.vpp');page.evaluate('jarvis.ssclose()')
        page.get_by_title('Load a minimal task').click()
        page.evaluate('''({text,dtd})=>{
            const schema=dtd_parser.parse(dtd,'dtd');app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;
            app_hotpot.set_dtd(schema);app_hotpot.vpp.$data.dtd=schema;
            const ann=app_hotpot.vpp.add_sample_txt_as_ann(text);ann._filename='fictional-note.txt.xml';
            app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);
        }''',{'text':note['text'],'dtd':dtd})
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/(profile+'.nmt-model.zip')))
        expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
        page.get_by_test_id('assist-mode').select_option('auto');page.get_by_test_id('assist-analyze').click()
        page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy',timeout=600000)
        actual=page.evaluate('app_hotpot.vpp.$data.anns[0].tags')
        assert len(actual)==len(note['records']),(actual,page.get_by_test_id('assist-message').text_content())
        for row in note['records']:
            hit=next(t for t in actual if t['tag']==row['family'] and t['text']==row['anchor'][0]['text'])
            for field,value in row['fields'].items():assert hit[field]==value
        assert not errors,errors
        page.screenshot(path=str(out/'original-ui.png'))
        (out/'report.json').write_text(json.dumps({'profile':profile,'browser':browser.version,'originalMedTatorUI':True,
            'actualWasmAutoApply':True,'spans':len(actual),'attributesExact':True,'clinicalValidation':False},indent=2),encoding='utf-8')
        print('Original UI '+profile+': real WASM auto apply, exact spans and attributes passed',flush=True);browser.close()
finally:server.terminate();server.wait(timeout=5)
