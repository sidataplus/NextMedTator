"""All supplied generated clinical notes, with real LoRA weights and explicit scope.

Runtime/source integrity gates fail on errors. Agreement with generated labels
is reported rather than treated as a clinical accuracy pass threshold.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from prepare_validation_notes import agreement
from lora_validation import validation_fixture

PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/clinical-v3-base.nmt-model.zip'))
FIXTURE = ROOT/'tests/fixtures/lora-clinical-samples.json'
URL = 'http://127.0.0.1:4192/'


def run():
    assert PACKAGE.is_file(), 'Actual merged LoRA package required; no mock/skip path'
    fixture, manifest = validation_fixture(json.loads(FIXTURE.read_text()), PACKAGE)
    assert fixture['source']['clinicalGoldStandard'] is False
    out = ROOT/'test-results'
    out.mkdir(exist_ok=True)
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'preview', '--port', '4192'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('Preview did not start')
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(executable_path=executable if Path(executable).exists() else None, args=['--no-sandbox'])
            context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors, requests = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.on('console', lambda message: print(message.text, flush=True) if message.text.startswith('Sample validation') else None)
            context.on('request', lambda r: requests.append({'url': r.url, 'method': r.method, 'body': r.post_data}))
            page.goto(URL)
            page.get_by_label('Open local documents or project').set_input_files([
                {'name': note['id']+'.txt', 'mimeType': 'text/plain', 'buffer': note['text'].encode()}
                for note in fixture['notes']])
            page.get_by_role('button', name='Export & assignments', exact=True).click()
            page.get_by_label('Start new project with schema JSON').set_input_files({
                'name': 'validation-schema.json', 'mimeType': 'application/json', 'buffer': json.dumps(fixture['schema']).encode()})
            expect(page.get_by_test_id('message')).to_contain_text('schema-specific project')
            page.get_by_role('button', name='Models', exact=True).click()
            page.get_by_label('Import local model package').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('message')).to_contain_text('loaded in memory')
            page.get_by_role('button', name='Run wasm-fp32 conformance', exact=True).click()
            page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.modelReport!==null')
            conformance = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.modelReport')
            assert conformance['pass'], conformance
            page.get_by_role('button', name='Privacy & storage', exact=True).click()
            page.get_by_role('button', name='Install app for offline use', exact=True).click()
            expect(page.get_by_test_id('message')).to_contain_text('App cache installed')
            page.wait_for_function('() => navigator.serviceWorker.controller!==null')
            context.set_offline(True)
            full_status = fixture['allReferenceEnums']['status']
            rejection = page.evaluate('''async values=>{
                const {validateSmallSchema}=await import('/app/nextmedtator/gliner-small.mjs');
                const schema={id:'full-status',version:'1',families:{event_occurrence:{fields:{status:{type:'enum',values}}}}};
                try {validateSmallSchema(schema);return null;} catch(error){return error.message;}
            }''', full_status)
            assert rejection and 'eight-query' in rejection, rejection
            result = page.evaluate('''async fixture=>{
                const w=document.querySelector('nextmedtator-workspace').workspace;
                const {makeRun}=await import('/app/nextmedtator/project.mjs');
                const {modelRunProvenance}=await import('/app/nextmedtator/model-package.mjs');
                const documents=w.project.current.documents, variant=w.model.manifest.variants[0];
                if(documents.length!==fixture.notes.length || documents.some((doc,i)=>doc.text!==fixture.notes[i].text))throw Error('Imported source differs');
                const elapsed=[];let started=0;
                const results=await w.modelRunner.analyzeBatch(w.model,variant.id,
                    documents.map(doc=>({text:doc.text,schema:w.project.current.schema,threshold:variant.threshold})),{
                        onProgress:i=>{started=performance.now();console.log('Sample validation '+(i+1)+'/'+documents.length);},
                        onResult:async(result,i)=>{
                            elapsed.push(performance.now()-started);
                            const records=result.records.map(r=>({...r,documentId:documents[i].id}));
                            const identity=modelRunProvenance(w.model,variant.id,result);
                            const run=await makeRun(w.project,documents[i],records,{...identity,status:result.status,coverage:result.coverage,
                                windows:result.windows,timing:{inferenceMs:elapsed[i]},settings:{codec:variant.codec,threshold:variant.threshold,scope:fixture.scope}});
                            await w.project.addRun(run);
                        }
                    });
                w.changed();w.render();
                return {results,elapsed,manifest:w.model.manifest,manifestHash:w.model.manifestHash,project:w.project.current};
            }''', fixture)
            assert len(result['results']) == fixture['counts']['notes']
            for note, row in zip(fixture['notes'], result['results']):
                assert row['status'] == 'complete', (note['id'], row['status'])
                assert row['coverage'] == [[0, len(note['text'])]], (note['id'], row['coverage'])
                assert row['windows']
                for record in row['records']:
                    assert len(record['anchor']) == 1
                    for span in record['anchor']+record['evidence']:
                        assert note['text'][span['start']:span['end']] == span['text']
                    assert record['origin']['codec'] == manifest['variants'][0]['codec']
                    for field in fixture['scope']['enums']:
                        assert record['fields'][field] in fixture['schema']['families'][record['family']]['fields'][field]['values']
            assert len(result['project']['runs']) == len(fixture['notes'])
            assert all(run['producer']['lineage']==result['manifest']['lineage'] for run in result['project']['runs'])
            page.get_by_role('button', name='Close panel', exact=True).click()
            with page.expect_download() as download:
                page.get_by_test_id('save').click()
            bundle = out/'lora-samples.nmt.zip'
            download.value.save_as(str(bundle))
            page.get_by_label('Open project/files').set_input_files(str(bundle))
            page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.project.current.runs.length===27')
            reopened = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
            assert reopened['runs'] == result['project']['runs']
            assert [doc['text'] for doc in reopened['documents']] == [n['text'] for n in fixture['notes']]
            assert not errors, errors
            assert all(r['url'].startswith(URL) and r['method']=='GET' and not r['body'] for r in requests), requests
            model_agreement = agreement(fixture['notes'], result['results'])
            timings = sorted(result['elapsed'])
            report = {'source': fixture['source'], 'counts': fixture['counts'], 'scope': fixture['scope'],
                      'browser': browser.version, 'runtimeVersion': result['manifest']['runtimeVersion'],
                      'packageId': result['manifest']['id'], 'manifestHash': result['manifestHash'],
                      'adapterLineage': result['manifest']['lineage'], 'modelConformancePassed': True,
                      'allNotesCompleteOffline': True, 'allSourceSpansValid': True,
                      'portableCorpusExportReopenExact': True, 'noNoteEgress': True,
                      'fullStatusSchemaRejectedExplicitly': {'choices': len(full_status), 'reason': rejection},
                      'windowCounts': [len(row['windows']) for row in result['results']],
                      'cloudTimingMs': {'median': timings[len(timings)//2], 'max': max(timings)},
                      'generatedReferenceAgreement': model_agreement}
            (out/'lora-samples.json').write_text(json.dumps(report, indent=2)+'\n')
            (out/'lora-samples-predictions.json').write_text(json.dumps({'source': fixture['source'], 'results': result['results']}, indent=2)+'\n')
            print(json.dumps({'runtimePass': True, 'notes': len(fixture['notes']), 'agreement': model_agreement['exactAnchors'], 'timing': report['cloudTimingMs']}, indent=2), flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == '__main__':
    run()
