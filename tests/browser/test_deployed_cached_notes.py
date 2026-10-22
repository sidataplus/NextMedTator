"""Restart Chrome with the installed package; compare all fictional source cases."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

root=Path(__file__).resolve().parents[2];profile=os.environ.get('NMT_MODEL_PROFILE','p10')
reference=json.loads((root/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))
out=root/'temp/browser-validation'/('deployed-'+profile)
assert (out/'report.json').exists(),'Run test_deployed_models.py first'
lines=['<!ENTITY name "'+profile+'_model">']
for entity in reference['contract']['entities']:
    lines.append('<!ELEMENT '+entity['family']+' (#PCDATA)>')
    for group in reference['contract']['attributes']:
        if entity['label'] in group['appliesTo']:lines.append('<!ATTLIST '+entity['family']+' '+group['field']+' ( '+' | '.join(r['value'] for r in group['labels'])+' ) #IMPLIED "">')
with sync_playwright() as p:
    context=p.chromium.launch_persistent_context(user_data_dir=str(out/'chrome-profile'),executable_path=chromium_path(),headless=True,viewport={'width':1600,'height':1000})
    context.route('https://nmt-models.sidata.plus/**',lambda route:route.abort())
    page=context.new_page();page.set_default_timeout(600000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
    page.goto('https://nmt.sidata.plus/');expect(page.locator('#start-screen')).to_be_hidden()
    page.wait_for_function('()=>!!document.querySelector("nextmedtator-assist").assist.model')
    page.get_by_title('Load a minimal task').click();results=[]
    for index,note in enumerate(reference['native']):
        page.evaluate('''({text,dtd,index})=>{const schema=dtd_parser.parse(dtd,'dtd');app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;app_hotpot.set_dtd(schema);app_hotpot.vpp.$data.dtd=schema;const ann=app_hotpot.vpp.add_sample_txt_as_ann(text);ann._filename='synthetic-case-'+index+'.txt.xml';app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);}''',{'text':note['text'],'dtd':'\n'.join(lines),'index':index})
        page.get_by_test_id('assist-mode').select_option('auto');page.get_by_test_id('assist-analyze').click()
        page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy')
        tags=page.evaluate('app_hotpot.vpp.$data.anns[0].tags')
        assert len(tags)==len(note['records']),(index,tags)
        for row in note['records']:
            anchor=row['anchor'][0]
            # Native Python offsets count code points; MedTator uses UTF-16 units.
            start=len(note['text'][:anchor['start']].encode('utf-16-le'))//2
            end=len(note['text'][:anchor['end']].encode('utf-16-le'))//2
            hit=next(t for t in tags if t['tag']==row['family'] and t['spans']==str(start)+'~'+str(end))
            assert hit['text']==anchor['text']
            for field,value in row['fields'].items():assert hit[field]==value
        page.screenshot(path=str(out/('04-case-'+str(index)+'.png')))
        results.append({'case':index,'spans':len(tags),'exactOffsetsTextAndAttributes':True})
        print(profile+': case '+str(index)+' passed',flush=True)
    assert not errors,errors
    (out/'cached-cases.json').write_text(json.dumps({'profile':profile,'browserRestart':True,'modelHostBlocked':True,'cases':results},indent=2),encoding='utf-8')
    context.close()
