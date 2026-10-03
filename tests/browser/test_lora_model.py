"""Real exported LoRA package: source conformance, offline review and original UI.

Set NMT_LORA_PACKAGE to the output of the standalone tool. This gate requires
real weights and never substitutes a mock model or silently skips.
"""
import json
import os
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(os.environ.get('NMT_LORA_PACKAGE', '/workspace/work/mixv1.nmt-model.zip'))


def check_lineage(data, manifest):
    runs = data['runs']
    assert runs and runs[-1]['producer']['lineage'] == manifest['lineage']
    assert runs[-1]['runtime']['variant']['codec'] == 'gliner25-records-v1'
    assert all(r['origin']['codec'] == 'gliner25-records-v1' for r in runs[-1]['records'])


def read_project(path):
    with zipfile.ZipFile(path) as archive:
        data = json.loads(archive.read('project.json'))
        data['runs'] = json.loads(archive.read('machine-runs/index.json'))
        return data


def run():
    assert PACKAGE.is_file(), 'Export the real adapter package first'
    with zipfile.ZipFile(PACKAGE) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        case = json.loads(archive.read('source-case-0.json'))
    assert manifest['lineage']['adapter'] and manifest['lineage']['merge'] == 'merged-export'
    out = ROOT/'test-results'
    out.mkdir(exist_ok=True)
    servers = []
    try:
        for directory, port in [('preview', 4190), ('dist', 4191)]:
            servers.append(subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', directory, '--port', str(port)], cwd=ROOT))
            for _ in range(100):
                try:
                    urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1).close()
                    break
                except Exception:
                    time.sleep(.1)
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(executable_path=executable if Path(executable).exists() else None, args=['--no-sandbox'])
            expect.set_options(timeout=180000)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            page.set_default_timeout(180000)
            errors, requests = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            context.on('request', lambda r: requests.append({'url': r.url, 'method': r.method, 'body': r.post_data}))
            page.on('dialog', lambda dialog: dialog.accept())
            url = 'http://127.0.0.1:4190/'
            page.goto(url)
            page.get_by_label('Open local documents or project').set_input_files({'name': 'lora-source.txt', 'mimeType': 'text/plain', 'buffer': case['text'].encode()})
            page.get_by_role('button', name='Export & assignments', exact=True).click()
            page.get_by_label('Start new project with schema JSON').set_input_files({'name': 'schema.json', 'mimeType': 'application/json', 'buffer': json.dumps(case['schema']).encode()})
            page.get_by_role('button', name='Models', exact=True).click()
            page.get_by_label('Import local model package').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('message')).to_contain_text('loaded in memory')
            print('Actual merged LoRA package imported', flush=True)
            page.get_by_role('button', name='Run wasm-fp32 conformance', exact=True).click()
            page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.modelReport!==null', timeout=180000)
            report = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.modelReport')
            assert report['pass'], report
            print('Real ORT Web source and numerical fixtures passed', flush=True)
            page.get_by_role('button', name='Install imported package for offline use', exact=True).click()
            expect(page.get_by_test_id('message')).to_contain_text('read-back verified')
            page.get_by_role('button', name='Privacy & storage', exact=True).click()
            page.get_by_role('button', name='Install app for offline use', exact=True).click()
            expect(page.get_by_test_id('message')).to_contain_text('App cache installed')
            page.wait_for_function('() => navigator.serviceWorker.controller!==null')
            context.set_offline(True)
            page.reload()
            page.get_by_test_id('sample').wait_for()
            page.get_by_label('Open local documents or project').set_input_files({'name': 'offline-lora.txt', 'mimeType': 'text/plain', 'buffer': case['text'].encode()})
            page.get_by_role('button', name='Export & assignments', exact=True).click()
            page.get_by_label('Start new project with schema JSON').set_input_files({'name': 'schema.json', 'mimeType': 'application/json', 'buffer': json.dumps(case['schema']).encode()})
            page.get_by_role('button', name='Models', exact=True).click()
            page.get_by_role('button', name='List installed models', exact=True).click()
            page.get_by_role('button', name='Use installed '+manifest['id'], exact=True).click()
            page.get_by_role('button', name='Close panel', exact=True).click()
            page.get_by_test_id('analyze').click()
            expect(page.get_by_test_id('suggestion')).to_have_count(len(case['records']))
            current = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
            check_lineage(current, manifest)
            for checkbox in page.get_by_role('checkbox', name='Select suggestion for group review', exact=True).all():
                checkbox.check()
            page.get_by_role('button', name='Accept selected suggestions', exact=True).click()
            expect(page.get_by_test_id('human-record')).to_have_count(len(case['records']))
            page.get_by_role('button', name='Review completeness', exact=True).click()
            page.get_by_role('checkbox', name='I checked the whole document', exact=False).check()
            page.get_by_test_id('complete').click()
            page.get_by_test_id('freeze').click()
            page.get_by_role('button', name='Compare & adjudicate', exact=True).click()
            page.locator('.details').get_by_role('checkbox').check()
            page.get_by_test_id('machine-snapshot').click()
            page.get_by_role('button', name='Compare snapshots', exact=True).click()
            page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.comparison!==undefined')
            comparison = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.comparison')
            assert comparison['anchors']['f1'] == 1 and comparison['interpretation'] == 'disagreement-analysis-not-accuracy'
            page.get_by_role('button', name='Close panel', exact=True).click()
            with page.expect_download() as downloaded:
                page.get_by_test_id('save').click()
            bundle = out/'lora-offline-project.nmt.zip'
            downloaded.value.save_as(str(bundle))
            check_lineage(read_project(bundle), manifest)
            page.get_by_label('Open project/files').set_input_files(str(bundle))
            expect(page.get_by_test_id('suggestion')).to_have_count(len(case['records']))
            canary = 'NMT_LORA_PRIVATE_CANARY'
            page.get_by_label('Open project/files').set_input_files({'name': canary+'.txt', 'mimeType': 'text/plain', 'buffer': (case['text']+' '+canary).encode()})
            page.get_by_test_id('analyze').click()
            expect(page.get_by_test_id('message')).to_contain_text('local span suggestion')
            structured = json.loads(json.dumps(case['schema']))
            structured['id'] = 'lora-structured-browser-case'
            structured['families']['diagnosis']['fields'].update({
                'certainty': {'type': 'enum', 'values': ['present', 'negated', 'unknown']},
                'medication': {'type': 'span'},
            })
            page.get_by_role('button', name='Export & assignments', exact=True).click()
            page.get_by_label('Start new project with schema JSON').set_input_files({'name': 'structured.json', 'mimeType': 'application/json', 'buffer': json.dumps(structured).encode()})
            page.get_by_role('button', name='Close panel', exact=True).click()
            page.get_by_test_id('analyze').click()
            expect(page.get_by_test_id('message')).to_contain_text('local span suggestion')
            page.wait_for_function('() => {const w=document.querySelector("nextmedtator-workspace").workspace;return !w.busy && w.project.current.runs.length>0;}')
            structured_run = page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.runs.at(-1)')
            diagnoses = [row for row in structured_run['records'] if row['family']=='diagnosis']
            assert diagnoses, structured_run
            assert all(row['fields']['certainty'] in ['present', 'negated', 'unknown'] for row in diagnoses)
            assert all(row['fields']['medication'] is None or isinstance(row['fields']['medication'], list) for row in diagnoses)
            assert not errors, errors
            assert all(row['url'].startswith(url) and row['method']=='GET' and not row['body'] and canary not in row['url'] for row in requests), requests
            context.close()
            print('Offline inference, review, compare, export, reopen and lineage passed', flush=True)

            # Exercise the actual original Vue/CodeMirror annotation screen separately.
            legacy = browser.new_context(accept_downloads=True, viewport={'width': 1366, 'height': 768})
            page = legacy.new_page()
            page.set_default_timeout(180000)
            legacy_errors, legacy_requests = [], []
            page.on('pageerror', lambda e: legacy_errors.append(str(e)))
            legacy.on('request', lambda r: legacy_requests.append({'url':r.url, 'method':r.method, 'body':r.post_data}))
            legacy_url = 'http://127.0.0.1:4191/'
            page.goto(legacy_url)
            page.wait_for_function('() => window.app_hotpot?.vpp!=null')
            page.evaluate('jarvis.ssclose()')
            page.get_by_title('Load a minimal task').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            name = page.evaluate('''fixture=>{const lines=['<!ENTITY name "lora_task">',...Object.keys(fixture.schema.families).map(name=>'<!ELEMENT '+name+' (#PCDATA)>')];const dtd=dtd_parser.parse(lines.join(String.fromCharCode(10)),'dtd');app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;app_hotpot.set_dtd(dtd);app_hotpot.vpp.$data.dtd=dtd;const ann=app_hotpot.vpp.add_sample_txt_as_ann(fixture.text);app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return ann._filename;}''', case)
            page.locator('.file-list-item-name', has_text=name).click()
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded')
            page.get_by_test_id('assist-analyze').click()
            expect(page.get_by_test_id('assist-suggestion')).to_have_count(len(case['records']))
            assert page.evaluate('!!window.app_hotpot.vpp && !!window.app_hotpot.codemirror')
            page.get_by_test_id('assist-suggestion').first.get_by_test_id('assist-locate').click()
            assert page.evaluate('app_hotpot.codemirror.getSelection()') in ['diabetes', 'metformin']
            page.get_by_test_id('assist-suggestion').first.get_by_test_id('assist-accept').click()
            page.get_by_test_id('assist-suggestion').nth(1).get_by_test_id('assist-reject').click()
            page.get_by_test_id('assist-add').click()
            assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length') == 1
            with page.expect_download() as downloaded:
                page.get_by_role('button', name='Export evidence project', exact=True).click()
            legacy_bundle = out/'lora-legacy-project.nmt.zip'
            downloaded.value.save_as(str(legacy_bundle))
            data = read_project(legacy_bundle)
            check_lineage(data, manifest)
            assert data['exposure'] and data['draft']['records'][0]['origin']['runId'] == data['runs'][0]['id']
            statuses = [decision['status'] for decision in data['draft']['decisions'].values()]
            assert len(statuses)==2 and 'rejected' in statuses and sum(status in ['accepted','modified'] for status in statuses)==1
            page.wait_for_timeout(3500)
            page.screenshot(path=str(out/'lora-original-ui.png'), full_page=True)
            assert not legacy_errors, legacy_errors
            assert all(row['url'].startswith(legacy_url) and row['method']=='GET' and not row['body'] for row in legacy_requests), legacy_requests
            result = {'realMergedAdapterWeights': True, 'packageId': manifest['id'], 'packageBytes': PACKAGE.stat().st_size,
                      'baseRevision': manifest['lineage']['base']['revision'], 'adapterHash': manifest['lineage']['adapter']['sha256'],
                      'browserConformance': report, 'installedModelOfflineRestart': True,
                      'offlineInferenceReviewCompareExportReopen': True, 'adapterLineagePreserved': True,
                      'originalVueCodeMirrorAcceptRejectExport': True, 'privateCanaryNoEgress': True,
                      'enumAndAnchoredSpanSchemaInference': True,
                      'browser': browser.version}
            (out/'lora-browser.json').write_text(json.dumps(result, indent=2)+'\n')
            print(json.dumps({k:v for k,v in result.items() if k!='browserConformance'}, indent=2))
            legacy.close()
            browser.close()
    finally:
        for server in servers:
            server.terminate()
            server.wait(timeout=5)


if __name__ == '__main__':
    run()
