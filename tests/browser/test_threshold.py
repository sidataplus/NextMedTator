"""Real v3 ONNX threshold control, immutable scoped runs and portable provenance.

Run against the built original UI and engineering preview, sequentially to bound
memory. Requires the real exported package; no injected predictions or skips.
"""
import json, os, subprocess, sys, time, urllib.request, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/clinical-v3-17089.nmt-model.zip'))
OUT = ROOT / 'test-results/threshold'
OUT.mkdir(parents=True, exist_ok=True)
assert PACKAGE.is_file(), 'Real v3 model package required'
with zipfile.ZipFile(PACKAGE) as archive:
    manifest = json.loads(archive.read('manifest.json'))
    case = json.loads(archive.read('source-case-6.json'))
assert manifest['variants'][0]['codec'] == 'gliner25-clinical-v3-spans-v1'
notes = json.loads((ROOT/'tests/fixtures/lora-clinical-samples.json').read_text())['notes']
notes = [next(n for n in notes if n['id'] == name) for name in ['syn7_00007','syn7_00014']]
DEFINITION = 'Extract behavioral and psychological symptoms of dementia: agitation, aggression, pacing, wandering, care resistance, yelling, repetitive questioning, hallucinations, delusions, depression, anxiety, apathy, disinhibition and disturbed sleep. Exclude falls, diagnoses, pain, medications, measurements, ADLs and care services.'


def state(page, native=True):
    return page.evaluate('''native=>{const w=document.querySelector(native?'nextmedtator-assist':'nextmedtator-workspace')[native?'assist':'workspace'];return {busy:w.busy,error:w.error,message:w.message,runs:native?w.runHistory:w.project.current.runs,scope:native?w.scope:null};}''', native)


def analyze(page, button, native=True):
    page.get_by_test_id(button).click()
    expect(page.get_by_test_id('assist-threshold' if native else 'threshold')).to_be_disabled()
    page.wait_for_function('''native=>!document.querySelector(native?'nextmedtator-assist':'nextmedtator-workspace')[native?'assist':'workspace'].busy''', arg=native, timeout=300000)
    result = state(page,native)
    assert not result['error'],result['message']
    return result


results = {}
for directory, port in [('dist',4198),('preview',4199)]:
    url = f'http://127.0.0.1:{port}/'
    server = subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory',directory,'--port',str(port)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url,timeout=1).close()
                break
            except Exception: time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':1600,'height':1500},accept_downloads=True)
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors, requests = [], []
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append(r.url))
            page.on('dialog',lambda d:d.accept())
            page.goto(url)
            if directory == 'dist':
                page.wait_for_function('window.app_hotpot?.vpp!=null')
                page.evaluate('jarvis.ssclose()')
                page.get_by_title('Load a minimal task').click()
                page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for()
                page.evaluate('''notes=>{app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;for(const n of notes){const a=app_hotpot.vpp.add_sample_txt_as_ann(n.text);a._filename=n.id+'.txt.xml';}app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);}''',notes)
                page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(PACKAGE))
                expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
                page.get_by_test_id('scope-edit').click()
                page.get_by_test_id('scope-preset').select_option('events-function')
                page.get_by_test_id('scope-family-function_occurrence').uncheck()
                page.get_by_test_id('scope-name').fill('BPSD')
                page.get_by_test_id('scope-definition').fill(DEFINITION)
                page.get_by_test_id('scope-use-schema').click()
                page.get_by_test_id('scope-apply').click()
                expect(page.get_by_test_id('assist-message')).to_contain_text('Scope applied: BPSD')
                expect(page.get_by_test_id('assist-threshold')).to_have_value('0.6')
                first = analyze(page,'assist-analyze')
                assert len(first['runs'])==1 and len(first['runs'][0]['records'])==5
                assert first['runs'][0]['settings']['threshold']==.6
                assert first['runs'][0]['settings']['thresholdSource']=='scope'
                page.screenshot(path=str(OUT/'suggestion-threshold-06.png'),full_page=True)
                # Invalid values cannot fall back to a model default or create a run.
                for invalid in ['1.1','']:
                    page.get_by_test_id('assist-threshold').fill(invalid)
                    page.get_by_test_id('assist-analyze').click()
                    page.wait_for_function('!document.querySelector("nextmedtator-assist").assist.busy')
                    expect(page.get_by_test_id('assist-message')).to_contain_text('between 0 and 1')
                    assert state(page)['runs']==first['runs']
                page.get_by_test_id('assist-threshold').fill('0.9')
                for n in notes: page.get_by_role('checkbox',name=n['id']+'.txt.xml',exact=True).check()
                second = analyze(page,'assist-analyze-selected')
                assert len(second['runs'])==3 and second['runs'][0]==first['runs'][0]
                assert second['scope']==first['scope']
                for run in second['runs'][1:]:
                    assert run['settings']['threshold']==.9 and run['settings']['thresholdSource']=='user'
                    assert run['settings']['scope']['profile']==first['scope']
                assert len(second['runs'][1]['records'])==1
                expect(page.get_by_test_id('assist-run-threshold')).to_have_text('Run threshold: 0.9')
                page.screenshot(path=str(OUT/'suggestion-threshold-09.png'),full_page=True)
                # Selected override and immutable run history survive corpus transport.
                recovered=page.evaluate('''async()=>{const a=document.querySelector('nextmedtator-assist').assist;const saved=await a.captureCorpus();await a.restoreCorpus(saved);return {override:a.thresholdOverride,runs:a.runHistory};}''')
                assert recovered['override']=='0.9'
                assert {r['id']:r for r in recovered['runs']}=={r['id']:r for r in second['runs']}
                with page.expect_download() as d:
                    page.get_by_role('button',name='Export evidence project',exact=True).click()
                d.value.save_as(str(OUT/'threshold.nmt.zip'))
                with zipfile.ZipFile(OUT/'threshold.nmt.zip') as z:
                    exported=json.loads(z.read('machine-runs/index.json'))
                assert [r['settings']['threshold'] for r in exported]==[.6,.9]
                assert exported[0]==first['runs'][0]
                page.get_by_test_id('assist-threshold-reset').click()
                expect(page.get_by_test_id('assist-threshold')).to_have_value('0.6')
                assert {r['id']:r for r in state(page)['runs']}=={r['id']:r for r in second['runs']}
                results['originalUI']={'baselineThreshold':.6,'baselineSuggestions':5,'userThreshold':.9,'stricterSuggestions':1,'batchThresholds':[r['settings']['threshold'] for r in second['runs'][1:]],'oldRunsUnchanged':True,'scopeUnchanged':True,'invalidInputRejected':True,'corpusTransport':True,'portableExport':True,'busyControlDisabled':True}
            else:
                page.get_by_label('Open local documents or project').set_input_files({'name':'source.txt','mimeType':'text/plain','buffer':case['text'].encode()})
                page.get_by_role('button',name='Export & assignments',exact=True).click()
                page.get_by_label('Start new project with schema JSON').set_input_files({'name':'schema.json','mimeType':'application/json','buffer':json.dumps(case['schema']).encode()})
                page.get_by_role('button',name='Models',exact=True).click()
                page.get_by_label('Import local model package').set_input_files(str(PACKAGE))
                expect(page.get_by_test_id('message')).to_contain_text('loaded in memory')
                page.get_by_role('button',name='Close panel',exact=True).click()
                expect(page.get_by_test_id('threshold')).to_have_value('0.6')
                print('Preview package imported; running baseline',flush=True)
                first=analyze(page,'analyze',False)
                print('Preview baseline complete',flush=True)
                assert len(first['runs'][0]['records'])==len(case['records'])
                page.get_by_test_id('threshold').fill('0.9')
                second=analyze(page,'analyze',False)
                print('Preview override complete',flush=True)
                assert len(second['runs'])==2 and second['runs'][0]==first['runs'][0]
                assert second['runs'][1]['settings']['threshold']==.9
                assert second['runs'][1]['settings']['thresholdSource']=='user'
                assert len(second['runs'][1]['records'])<len(first['runs'][0]['records'])
                page.get_by_test_id('threshold-reset').click()
                expect(page.get_by_test_id('threshold')).to_have_value('0.6')
                results['preview']={'baselineSuggestions':len(first['runs'][0]['records']),'stricterSuggestions':len(second['runs'][1]['records']),'oldRunsUnchanged':True,'busyControlDisabled':True}
            assert not errors,errors
            assert all(r.startswith(url) or r.startswith('blob:') for r in requests),requests
            print(directory,results['originalUI' if directory=='dist' else 'preview'],flush=True)
            browser.close()
    finally:
        server.terminate();server.wait(timeout=5)
(OUT/'report.json').write_text(json.dumps({'model':manifest['id'],'realWeights':True,'noteEgress':False,**results},indent=2)+'\n')
print('Real ONNX adjustable threshold gate passed',flush=True)
