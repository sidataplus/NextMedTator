"""Real LoRA scope gate in the original MedTator UI; no injected predictions."""
import json
import os
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/clinical-p7b.nmt-model.zip'))
URL = 'http://127.0.0.1:4195/'


def run():
    assert PACKAGE.is_file(), 'Actual merged adapter package required'
    fixture = json.loads((ROOT/'tests/fixtures/lora-clinical-samples.json').read_text())
    notes = [fixture['notes'][0], fixture['notes'][23]]
    out = ROOT/'test-results'
    out.mkdir(exist_ok=True)
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'dist', '--port', '4195'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':1600,'height':2000}, accept_downloads=True)
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors, requests = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: requests.append({'url':r.url,'method':r.method,'body':r.post_data}))
            page.goto(URL)
            page.wait_for_function('window.app_hotpot?.vpp!=null')
            page.evaluate('jarvis.ssclose()')
            page.get_by_title('Load a minimal task').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            names = page.evaluate('''notes=>{
                app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;
                const names=notes.map(n=>{const a=app_hotpot.vpp.add_sample_txt_as_ann(n.text);a._filename=n.id+'.txt.xml';return a._filename;});
                app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return names;
            }''', notes)
            page.get_by_test_id('scope-edit').click()
            expect(page.get_by_test_id('scope-preset').locator('option')).to_have_count(5)
            assert 'BPSD' not in page.get_by_test_id('scope-preset').inner_text()
            # Replace only the empty task schema through the real UI.
            page.get_by_test_id('scope-use-schema').click()
            expect(page.get_by_test_id('assist-message')).to_contain_text('Clinical annotation schema loaded')
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
            assert page.get_by_test_id('scope-field-treatment_occurrence-status').is_disabled()
            page.get_by_test_id('scope-apply').click()
            expect(page.get_by_test_id('assist-message')).to_contain_text('Scope applied: All clinical evidence')
            page.get_by_test_id('scope-edit').click()
            page.get_by_test_id('scope-edit').scroll_into_view_if_needed()
            page.screenshot(path=str(out/'clinical-scope-broad-editor.png'), full_page=True)
            page.get_by_test_id('scope-edit').click()
            for name in names:
                page.get_by_role('checkbox', name=name, exact=True).check()
            page.get_by_test_id('assist-analyze-selected').click()
            page.wait_for_function('''()=>{const a=document.querySelector('nextmedtator-assist').assist;return a.runHistory.length===2&&!a.busy;}''', timeout=300000)
            before = page.evaluate('''()=>document.querySelector('nextmedtator-assist').assist.runHistory.map(r=>JSON.parse(JSON.stringify(r)))''')
            assert all(r['status']=='complete' for r in before), before
            print('Broad scope actual adapter counts', [len(r['records']) for r in before], flush=True)
            # Two freely entered concepts, no disease-specific preset.
            page.get_by_test_id('scope-edit').click()
            page.get_by_test_id('scope-preset').select_option('events-function')
            page.get_by_test_id('scope-name').fill('Daily care and mobility')
            page.get_by_test_id('scope-definition').fill('Extract documented care interactions and mobility problems. Exclude unrelated diagnoses and medications.')
            concepts = [
                {'concept_id':'care_resistance','family':'event_occurrence','description':'Refusal or resistance during personal care, dressing, washing or assistance.','aliases':'refusing care\nresists washing'},
                {'concept_id':'mobility_difficulty','family':'function_occurrence','description':'Documented difficulty with walking, transfers or mobility.','aliases':'needs help walking\nunsteady gait'},
            ]
            for c in concepts:
                page.get_by_test_id('scope-add-concept').click()
                card = page.get_by_test_id('scope-concept').last
                card.get_by_test_id('scope-concept-id').fill(c['concept_id'])
                card.get_by_test_id('scope-concept-family').select_option(c['family'])
                card.get_by_test_id('scope-concept-description').fill(c['description'])
                card.get_by_test_id('scope-concept-aliases').fill(c['aliases'])
            page.set_viewport_size({'width':1600,'height':3200})
            page.get_by_test_id('scope-name').scroll_into_view_if_needed()
            page.screenshot(path=str(out/'clinical-scope-custom-editor.png'), full_page=True)
            page.get_by_test_id('scope-apply').click()
            expect(page.get_by_test_id('assist-message')).to_contain_text('Scope applied: Daily care and mobility')
            page.set_viewport_size({'width':1600,'height':2400})
            assert page.evaluate('''before=>JSON.stringify(document.querySelector('nextmedtator-assist').assist.runHistory)===JSON.stringify(before)''', before)
            page.get_by_test_id('assist-mode').select_option('auto')
            page.get_by_test_id('assist-analyze-selected').click()
            page.wait_for_function('''()=>{const a=document.querySelector('nextmedtator-assist').assist;return a.runHistory.length===4&&!a.busy;}''', timeout=300000)
            expect(page.get_by_test_id('assist-message')).to_contain_text('Auto apply finished for 2 notes')
            result = page.evaluate('''()=>{
                const a=document.querySelector('nextmedtator-assist').assist;
                return {scope:a.scope,runs:a.runHistory.map(r=>JSON.parse(JSON.stringify(r))),projects:[...a.projects.values()].map(p=>p.current),tags:app_hotpot.vpp.$data.anns.map(n=>n.tags)};
            }''')
            assert result['runs'][:2] == before
            scoped = result['runs'][2:]
            for note, run, tags in zip(notes, scoped, result['tags']):
                assert run['status']=='complete' and run['coverage']==[[0,len(note['text'])]]
                assert run['settings']['scope']['profile']==result['scope']
                assert len(tags)==len(run['records'])
                for r in run['records']:
                    assert r['family'] in ['event_occurrence','function_occurrence']
                    assert r['conceptId'] in ['care_resistance','mobility_difficulty']
                    for span in r['anchor']+r['evidence']:
                        assert note['text'][span['start']:span['end']]==span['text']
            assert sum(len(r['records']) for r in scoped)>0, 'Actual scoped outputs required'
            for project in result['projects']:
                for record in project['draft']['records']:
                    assert record['origin']['reviewStatus']=='unreviewed'
                    assert record['conceptId'] in ['care_resistance','mobility_difficulty']
            for i, name in enumerate(names):
                page.locator('.file-list-item-name', has_text=name).click()
                page.get_by_test_id('assist-suggestion-view').select_option('compact')
                expect(page.get_by_test_id('assist-counts')).to_contain_text(f'{len(scoped[i]["records"])} annotation tags')
                if scoped[i]['records']:
                    page.get_by_test_id('assist-compact-suggestion').first.scroll_into_view_if_needed()
                else:
                    page.get_by_test_id('assist-counts').scroll_into_view_if_needed()
                page.screenshot(path=str(out/f'clinical-scope-{notes[i]["id"]}-auto.png'),full_page=True)
            page.get_by_test_id('scope-edit').click()
            with page.expect_download() as d:
                page.get_by_test_id('scope-export-semantic').click()
            d.value.save_as(str(out/'clinical-scope-semantic-schema.json'))
            # Schema replacement is blocked once evidence/tags exist.
            tags_before = page.evaluate('JSON.stringify(app_hotpot.vpp.$data.anns.map(n=>n.tags))')
            page.get_by_test_id('scope-use-schema').click()
            expect(page.get_by_test_id('assist-message')).to_contain_text('reviewed schema migration')
            assert tags_before==page.evaluate('JSON.stringify(app_hotpot.vpp.$data.anns.map(n=>n.tags))')
            page.get_by_test_id('scope-edit').click()
            with page.expect_download() as d:
                page.get_by_role('button',name='Export evidence project',exact=True).click()
            bundle=out/'clinical-scope-evidence.nmt.zip'
            d.value.save_as(str(bundle))
            with zipfile.ZipFile(bundle) as z:
                project=json.loads(z.read('project.json'))
                assert project['extensions']['suggestionScope']==result['scope']
                assert project['draft']['records'] and all(r.get('conceptId') for r in project['draft']['records'])
                runs=json.loads(z.read('machine-runs/index.json'))
                assert len(runs)==2 and runs[-1]['settings']['scope']['profile']==result['scope']
            # Exercise corpus checkpoint capture/restore with real runs.
            recovery = page.evaluate('''async()=>{
                const a=document.querySelector('nextmedtator-assist').assist;
                const before=JSON.stringify(a.runHistory),scope=JSON.stringify(a.scope),corpus=await a.captureCorpus();
                await a.restoreCorpus(corpus);
                return {sameScope:scope===JSON.stringify(a.scope),sameRuns:before===JSON.stringify(a.runHistory),counts:app_hotpot.vpp.$data.anns.map(n=>n.tags.length)};
            }''')
            # Child-project order groups old/new runs; compare identities rather than temporal array order.
            assert recovery['sameScope'] and recovery['counts']==[len(r['records']) for r in scoped]
            restored=page.evaluate('''()=>document.querySelector('nextmedtator-assist').assist.runHistory''')
            assert {r['fingerprint'] for r in restored}=={r['fingerprint'] for r in result['runs']}
            assert not errors, errors
            assert all(r['url'].startswith(URL) and r['method']=='GET' and not r['body'] for r in requests), requests
            report={'browser':browser.version,'source':fixture['source'],'noteIds':[n['id'] for n in notes],
                    'broadCounts':[len(r['records']) for r in before],'customCounts':[len(r['records']) for r in scoped],
                    'allRunsComplete':True,'sourceOffsetsValid':True,'oldRunsUnchanged':True,'conceptMappingRetained':True,
                    'nativeAutoApplyUnreviewed':True,'nativeExportRetainsScope':True,'corpusRecoveryRetainsScopeAndRuns':True,
                    'noNoteEgress':True,'clinicalAccuracy':'Not qualified; descriptions guide retrieval, they do not guarantee semantic membership',
                    'scope':result['scope'],'runs':result['runs']}
            (out/'clinical-scope-ui.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps({k:v for k,v in report.items() if k not in ['scope','runs']},indent=2),flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__=='__main__':
    run()
