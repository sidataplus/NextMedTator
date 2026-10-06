"""Run every supplied note in original MedTator and photograph real suggestions.

Screenshots include the reported missing negated pain, a low-agreement note,
a negated-pain success or omission and a dense prediction list. Capture the untouched raw
list first, then the user's explicit auto-apply workflow. Generated labels are
unverified; automatic tags are not individually reviewed.
"""
import json
import copy
import os
import re
import subprocess
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict, deque
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from prepare_validation_notes import agreement

PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/clinical-p7b.nmt-model.zip'))
URL = 'http://127.0.0.1:4194/'


def run():
    assert PACKAGE.is_file(), 'Actual merged adapter package required; no mock/skip path'
    fixture = json.loads((ROOT/'tests/fixtures/lora-clinical-samples.json').read_text())
    with zipfile.ZipFile(PACKAGE) as package:
        manifest = json.loads(package.read('manifest.json'))
    lines = ['<!ENTITY name "generated_clinical_samples">']
    for family, definition in fixture['schema']['families'].items():
        lines.append(f'<!ELEMENT {family} (#PCDATA)>')
        for field, spec in definition['fields'].items():
            if spec['type'] == 'enum':
                lines.append(f'<!ATTLIST {family} {field} ( '+ ' | '.join(spec['values'])+f' ) #IMPLIED "{spec["values"][0]}">')
            elif field != 'concept':
                lines.append(f'<!ATTLIST {family} {field} CDATA #IMPLIED "">')
    out = ROOT/'test-results'
    out.mkdir(exist_ok=True)
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'dist', '--port', '4194'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('Original UI did not start')
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(executable_path=executable if Path(executable).exists() else None, args=['--no-sandbox'])
            context = browser.new_context(accept_downloads=True, viewport={'width':1600,'height':1800})
            page = context.new_page()
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors, requests = [], []
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
                const names=notes.map(note=>{const ann=app_hotpot.vpp.add_sample_txt_as_ann(note.text);ann._filename=note.id+'.txt.xml';return ann._filename;});
                app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return names;
            }''', {'notes':fixture['notes'],'dtdText':'\n'.join(lines)})
            assert len(names) == 27
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
            for name in names:
                page.get_by_role('checkbox', name=name, exact=True).check()
            page.get_by_test_id('assist-analyze-selected').click()
            page.on('console', lambda message: print(message.text,flush=True) if message.text.startswith('Corpus progress') else None)
            page.evaluate('''()=>{
                let last=0;window.__corpusProgressTimer=setInterval(()=>{
                    const n=document.querySelector('nextmedtator-assist').assist.progress?.index??0;
                    if(n!==last){last=n;console.log('Corpus progress '+n+'/27');}
                },1000);
            }''')
            print('Original UI batch started: 27 notes, same schema and threshold', flush=True)
            page.wait_for_function('''() => {
                const a=document.querySelector('nextmedtator-assist').assist;
                return a.runs.size===27 && !a.busy;
            }''', timeout=300000)
            page.evaluate('clearInterval(window.__corpusProgressTimer)')
            batch = page.evaluate('''() => {
                const a=document.querySelector('nextmedtator-assist').assist;
                return app_hotpot.vpp.$data.anns.map(ann=>{
                    const run=[...a.runs.values()].find(r=>r.filename===ann._filename);
                    const project=run.project.current,native=project.runs.find(r=>r.id===run.nativeRunId);
                    return {filename:ann._filename,text:ann.text,records:run.records,status:run.status,
                        coverage:native.coverage,windows:native.windows,lineage:native.producer.lineage,
                        modelSourceText:project.documents[0].text,nativeTags:ann.tags.length};
                });
            }''')
            assert len(batch) == 27
            for note, result in zip(fixture['notes'], batch):
                assert result['filename'] == note['id']+'.txt.xml'
                assert result['text'] == result['modelSourceText'] == note['text']
                assert result['status'] == 'complete' and result['coverage'] == [[0,len(note['text'])]]
                assert result['lineage'] == manifest['lineage'] and result['nativeTags'] == 0
                for record in result['records']:
                    for span in record['anchor']+record['evidence']:
                        assert note['text'][span['start']:span['end']] == span['text']
            (out/'lora-original-corpus-predictions.json').write_text(json.dumps({'source':fixture['source'],'results':batch},indent=2)+'\n')
            # Legacy DTD CDATA is a text attribute. Its exact model-assigned
            # source span remains in evidence; adapt only the evaluator view.
            metric_results = copy.deepcopy(batch)
            for result in metric_results:
                for record in result['records']:
                    value = record['fields'].get('time_text')
                    if record['family']=='condition_occurrence' and isinstance(value,str):
                        spans = [span for span in record['evidence'] if span['text']==value]
                        assert len(spans)==1, 'Temporal text needs one retained model source span; no nearest-text guessing'
                        record['fields']['time_text'] = spans
            metrics = agreement(fixture['notes'], metric_results)
            pain_checks = []
            for note, result in zip(fixture['notes'], batch):
                available = defaultdict(deque)
                for record in result['records']:
                    span = record['anchor'][0]
                    available[(record['family'],span['start'],span['end'])].append(record)
                for ref in note['references']:
                    span = ref['anchor']
                    records = available[(ref['family'],span['start'],span['end'])]
                    found = records.popleft() if records else None
                    if re.search(r'\bpain\b',span['text'],re.I) and ref['choices'].get('assertion') == 'negated':
                        pain_checks.append({'id':note['id'],'anchor':span,'context':note['text'][max(0,span['start']-50):span['end']+40],
                                            'anchorDetected':found is not None,'predictedAssertion':found['fields'].get('assertion') if found else None})
            def f1(row):
                return 2*row['matched']/(row['predicted']+row['reference']) if row['predicted']+row['reference'] else 0
            low = min(range(27), key=lambda i:(f1(metrics['notes'][i]),fixture['notes'][i]['id']))
            dense = max(range(27), key=lambda i:len(batch[i]['records']))
            pain_success = next((row for row in pain_checks if row['anchorDetected'] and row['predictedAssertion']=='negated'), None)
            pain_example = pain_success or next(row for row in pain_checks if row['id']!=fixture['notes'][0]['id'])
            if pain_success:
                pain_reason = 'Successful negated pain'
            elif pain_example['anchorDetected']:
                pain_reason = 'Negated pain assertion incorrect'
            else:
                pain_reason = 'Negated pain omitted by model'
            negated = next(i for i,note in enumerate(fixture['notes']) if note['id']==pain_example['id'])
            selections = [(0,'Reported missing Denies pain'),(low,'Lowest exact-anchor agreement'),
                          (negated,pain_reason),(dense,'Most machine suggestions')]
            examples = []
            for index, reason in selections:
                note, result = fixture['notes'][index], batch[index]
                page.locator('.file-list-item-name', has_text=names[index]).click()
                expect(page.get_by_test_id('assist-counts')).to_contain_text(f'{len(result["records"])} machine suggestions · 0 annotation tags')
                page.get_by_test_id('assist-suggestion-view').select_option('compact')
                expect(page.get_by_test_id('assist-compact-suggestion')).to_have_count(len(result['records']))
                assert page.get_by_test_id('assist-suggestion').count() == 0
                if index == 0:
                    page.evaluate('''()=>{
                        const cm=app_hotpot.codemirror,text=cm.getValue(),start=text.indexOf('Denies pain.');
                        if(start<0)throw Error('Reported phrase not found');
                        cm.setSelection(cm.posFromIndex(start),cm.posFromIndex(start+'Denies pain.'.length));
                        cm.scrollIntoView({from:cm.posFromIndex(start),to:cm.posFromIndex(start+12)},80);
                    }''')
                elif index == negated and pain_success:
                    card = page.get_by_test_id('assist-compact-suggestion').filter(has=page.locator('strong',has_text=re.compile('^pain$')))
                    expect(card).to_have_count(1)
                    card.get_by_test_id('assist-compact-locate').click()
                    assert page.evaluate('app_hotpot.codemirror.getSelection()') == 'pain'
                else:
                    page.get_by_test_id('assist-compact-suggestion').first.get_by_test_id('assist-compact-locate').click()
                # Resize the real browser and use the real scrollable list;
                # every row must be visible in the capture, without DOM edits.
                for height in [1800,2000,2200,2400,2600]:
                    page.set_viewport_size({'width':1600,'height':height})
                    page.get_by_role('table',name='Machine suggestions').evaluate('el=>el.scrollIntoView({block:"start"})')
                    fit = page.get_by_role('table',name='Machine suggestions').evaluate('''table=>{
                        const body=table.closest('.body').getBoundingClientRect(),rows=[...table.querySelectorAll('tr')];
                        return rows[0].getBoundingClientRect().top>=body.top-1 && rows.at(-1).getBoundingClientRect().bottom<=body.bottom+1;
                    }''')
                    if fit: break
                assert fit, 'All actual suggestion rows must fit the screenshot'
                screenshot = f'{manifest["id"]}-{note["id"]}-suggestions.png'
                page.screenshot(path=str(out/screenshot), full_page=True)
                with page.expect_download() as download:
                    page.get_by_role('button',name='Export evidence project',exact=True).click()
                bundle = out/(note['id']+'-machine-evidence.nmt.zip')
                download.value.save_as(str(bundle))
                with zipfile.ZipFile(bundle) as archive:
                    project = json.loads(archive.read('project.json'))
                    runs = json.loads(archive.read('machine-runs/index.json'))
                    assert len(runs) == 1 and len(runs[0]['records']) == len(result['records'])
                    assert project['draft']['records'] == []
                    assert runs[0]['producer']['lineage'] == manifest['lineage']
                    assert archive.read(project['documents'][0]['sourceFile']).decode() == note['text']
                examples.append({'id':note['id'],'selectionReason':reason,'screenshot':screenshot,
                                 'viewport':page.viewport_size,'allMachineRowsVisible':True,'humanTags':0,
                                 'counts':metrics['notes'][index],'f1Agreement':f1(metrics['notes'][index]),
                                 'machinePredictionsExported':True})
                print('Captured',note['id'],len(result['records']),'actual suggestions:',reason,flush=True)
                page.get_by_test_id('assist-mode').select_option('auto')
                if index == dense:
                    # Real adapter inference in Auto mode must write without any
                    # individual acceptance or Apply-all click.
                    page.get_by_test_id('assist-analyze').click()
                    expect(page.get_by_test_id('assist-message')).to_contain_text('Auto apply finished for 1 notes')
                    application = 'Analyze note in Auto apply mode'
                else:
                    page.get_by_test_id('assist-apply-all').click()
                    expect(page.get_by_test_id('assist-message')).to_contain_text(f'Auto-applied {len(result["records"])} suggestions')
                    application = 'Apply all suggestions from existing run'
                expect(page.get_by_test_id('assist-counts')).to_have_text(f'{len(result["records"])} machine suggestions · {len(result["records"])} annotation tags')
                expect(page.get_by_test_id('assist-auto-status')).to_have_text(f'{len(result["records"])} machine-applied tags · unreviewed')
                expect(page.get_by_test_id('assist-apply-all')).to_be_disabled()
                expect(page.locator('.tag-table tbody tr')).to_have_count(len(result['records']))
                # A repeated explicit request is a no-op, including export.
                page.evaluate('document.querySelector("nextmedtator-assist").assist.applyAllSuggestions()')
                expect(page.locator('.tag-table tbody tr')).to_have_count(len(result['records']))
                page.get_by_test_id('assist-suggestion-view').select_option('compact')
                for height in [2200,2400,2600,2800,3000,3200,3400,3600]:
                    page.set_viewport_size({'width':1600,'height':height})
                    page.get_by_role('table',name='Machine suggestions').evaluate('el=>el.scrollIntoView({block:"start"})')
                    fit = page.get_by_role('table',name='Machine suggestions').evaluate('''table=>{
                        const body=table.closest('.body').getBoundingClientRect(),rows=[...table.querySelectorAll('tr')];
                        return rows[0].getBoundingClientRect().top>=body.top-1 && rows.at(-1).getBoundingClientRect().bottom<=body.bottom+1;
                    }''')
                    page.locator('#mui_annlist').evaluate('el=>el.scrollTop=0')
                    native_fit = page.locator('.tag-table').evaluate('''table=>{
                        const pane=table.closest('#mui_annlist').getBoundingClientRect(),rows=[...table.querySelectorAll('tbody tr')],head=table.querySelector('thead').getBoundingClientRect();
                        return rows[0].getBoundingClientRect().top>=head.bottom-1 && rows.at(-1).getBoundingClientRect().bottom<=pane.bottom-1;
                    }''')
                    if fit and native_fit: break
                assert fit and native_fit, 'All native annotation and machine rows must fit the auto screenshot'
                auto_screenshot = f'{manifest["id"]}-{note["id"]}-auto-applied.png'
                page.screenshot(path=str(out/auto_screenshot),full_page=True)
                with page.expect_download() as download:
                    page.get_by_role('button',name='Export evidence project',exact=True).click()
                auto_bundle = out/(note['id']+'-auto-applied.nmt.zip')
                download.value.save_as(str(auto_bundle))
                with zipfile.ZipFile(auto_bundle) as archive:
                    project = json.loads(archive.read('project.json'))
                    runs = json.loads(archive.read('machine-runs/index.json'))
                    assert len(project['draft']['records']) == len(result['records'])
                    assert len(runs)==(2 if index==dense else 1)
                    assert len(runs[-1]['records'])==len(result['records'])
                    for record in project['draft']['records']:
                        assert record['origin']['kind']=='machine-applied' and record['origin']['reviewStatus']=='unreviewed'
                        assert record['origin']['runId']==runs[-1]['id']
                    assert project['draft']['completeness']=={}
                    assert all(run['producer']['lineage']==manifest['lineage'] for run in runs)
                    assert runs[0]['records']==json.loads(zipfile.ZipFile(bundle).read('machine-runs/index.json'))[0]['records']
                    assert archive.read(project['documents'][0]['sourceFile']).decode()==note['text']
                examples[-1]['autoApply'] = {'action':application,'screenshot':auto_screenshot,'mode':'auto',
                                            'viewport':page.viewport_size,'nativeTags':len(result['records']),'allNativeRowsVisible':True,
                                            'individuallyReviewed':False,'reviewStatus':'unreviewed','repeatAddsNoDuplicates':True,
                                            'machineProvenanceExported':True,'originalPredictionsUnchanged':True}
                print('Captured auto apply',note['id'],len(result['records']),'native tags',flush=True)
                page.get_by_test_id('assist-mode').select_option('assisted')
            assert not errors, errors
            assert all(r['url'].startswith(URL) and r['method']=='GET' and not r['body'] for r in requests), requests
            report = {'packageId':manifest['id'],'lineage':manifest['lineage'],'threshold':manifest['variants'][0]['threshold'],
                      'browser':browser.version,'source':fixture['source'],'scope':fixture['scope'],
                      'notesRunInOriginalUI':27,'allRunsComplete':True,'allSourceOffsetsValid':True,
                      'rawScreenshotsHaveNoNativeTags':True,'autoApplyExplicitlyRequested':True,'noPredictionsInserted':True,'noNoteEgress':True,
                      'temporalMetricRepresentation':'Legacy time_text CDATA assessed through its exact retained model evidence span; machine outputs unchanged',
                      'generatedReferenceAgreement':metrics,'negatedPainChecks':pain_checks,'screenshots':examples}
            (out/'lora-original-corpus-ui.json').write_text(json.dumps(report,indent=2)+'\n')
            (out/'lora-original-corpus-predictions.json').write_text(json.dumps({'source':fixture['source'],'results':batch},indent=2)+'\n')
            print(json.dumps({'notes':27,'agreement':metrics['exactAnchors'],'negatedPainChecks':pain_checks,'screenshots':examples},indent=2),flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == '__main__':
    run()
