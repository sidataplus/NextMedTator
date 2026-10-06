"""Load the generated corpus and review a real LoRA suggestion in original MedTator."""
import json
import os
import re
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/clinical-p7b.nmt-model.zip'))
URL = 'http://127.0.0.1:4193/'
BEHAVIORS = ['pacing', 'verbal aggression', 'yelling', 'striking out']


def verify_export(path, fixture):
    with zipfile.ZipFile(path) as archive, zipfile.ZipFile(PACKAGE) as package:
        project = json.loads(archive.read('project.json'))
        runs = json.loads(archive.read('machine-runs/index.json'))
        manifest = json.loads(package.read('manifest.json'))
        assert len(project['documents']) == len(runs) == 1
        assert len(project['draft']['records']) == len(BEHAVIORS)
        assert archive.read(project['documents'][0]['sourceFile']).decode() == fixture['notes'][0]['text']
        assert runs[0]['producer']['lineage'] == manifest['lineage']
        records = project['draft']['records']
        assert {r['anchor'][0]['text'] for r in records} == set(BEHAVIORS)
        assert all(r['origin']['runId'] == runs[0]['id'] for r in records)
        assert all(r['family'] == 'event_occurrence' and r['fields']['experiencer'] == 'patient' for r in records)


def run():
    assert PACKAGE.is_file(), 'Actual LoRA weights required'
    fixture = json.loads((ROOT/'tests/fixtures/lora-clinical-samples.json').read_text())
    lines = ['<!ENTITY name "generated_clinical_samples">']
    for family, definition in fixture['schema']['families'].items():
        lines.append(f'<!ELEMENT {family} (#PCDATA)>')
        for field, spec in definition['fields'].items():
            if spec['type']=='enum':
                lines.append(f'<!ATTLIST {family} {field} ( '+ ' | '.join(spec['values'])+f' ) #IMPLIED "{spec["values"][0]}">')
            elif field!='concept':
                lines.append(f'<!ATTLIST {family} {field} CDATA #IMPLIED "">')
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'dist', '--port', '4193'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(executable_path=executable if Path(executable).exists() else None, args=['--no-sandbox'])
            context = browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
            page = context.new_page()
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors = []
            requests = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: requests.append({'url':r.url,'method':r.method,'body':r.post_data}))
            page.goto(URL)
            page.wait_for_function('() => window.app_hotpot?.vpp!=null')
            page.evaluate('jarvis.ssclose()')
            page.get_by_title('Load a minimal task').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            names = page.evaluate('''({notes,dtdText})=>{
                const dtd=dtd_parser.parse(dtdText,'dtd');app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;
                app_hotpot.set_dtd(dtd);app_hotpot.vpp.$data.dtd=dtd;
                const names=notes.map(note=>app_hotpot.vpp.add_sample_txt_as_ann(note.text)._filename);
                app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return names;
            }''', {'notes':fixture['notes'],'dtdText':'\n'.join(lines)})
            assert len(names)==27
            page.locator('.file-list-item-name', has_text=names[0]).click()
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
            page.get_by_test_id('assist-analyze').click()
            expect(page.get_by_test_id('assist-suggestion').first).to_be_visible()
            suggestion_count = page.get_by_test_id('assist-suggestion').count()
            out = ROOT/'test-results'
            def behavior_card(text):
                return page.get_by_test_id('assist-suggestion').filter(
                    has=page.locator('p.anchor', has_text=re.compile('^'+re.escape(text)+'$')))
            # Show actual behavior suggestions, then exercise multiple explicit
            # writes. The previous smoke screenshot accepted only the first
            # care-context prediction and hid the remaining 16 suggestions.
            behavior_card(BEHAVIORS[0]).get_by_test_id('assist-locate').click()
            behavior_card(BEHAVIORS[0]).scroll_into_view_if_needed()
            page.screenshot(path=str(out/'lora-samples-behavior-suggestions.png'), full_page=True)
            for behavior in BEHAVIORS:
                card = behavior_card(behavior)
                expect(card).to_have_count(1)
                card.get_by_test_id('assist-locate').click()
                assert page.evaluate('app_hotpot.codemirror.getSelection()') == behavior
                card.get_by_test_id('assist-accept').click()
                # These actions describe the resident. Exercise the review
                # correction form rather than copying mistaken model values.
                card.get_by_label('experiencer', exact=True).select_option('patient')
                page.get_by_test_id('assist-add').click()
            assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length') == len(BEHAVIORS)
            assert page.evaluate('app_hotpot.vpp.$data.anns.length') == 27
            behavior_card('verbal aggression').get_by_test_id('assist-locate').click()
            behavior_card('pacing').scroll_into_view_if_needed()
            page.screenshot(path=str(out/'lora-samples-original-ui.png'), full_page=True)
            with page.expect_download() as download:
                page.get_by_role('button', name='Export evidence project', exact=True).click()
            download.value.save_as(str(out/'lora-samples-original-ui.nmt.zip'))
            verify_export(out/'lora-samples-original-ui.nmt.zip', fixture)
            assert not errors, errors
            assert all(r['url'].startswith(URL) and r['method']=='GET' and not r['body'] for r in requests), requests
            report = {'corpusDocumentsInOriginalUI':27, 'representativeId':fixture['notes'][0]['id'],
                      'actualLoRAInferLocateAcceptNativeTagExport':True, 'noNoteEgress':True, 'browser':browser.version,
                      'machineSuggestionsInRepresentativeNote':suggestion_count,
                      'acceptedBehaviorTags':BEHAVIORS, 'nativeTagCount':len(BEHAVIORS),
                      'reviewCorrections':{'experiencer':'patient'},
                      'tagOntology':'Behavioral events use event_occurrence in the supplied six-family schema; no dedicated BPSD tag'}
            (out/'lora-samples-original-ui.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2), flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == '__main__':
    run()
