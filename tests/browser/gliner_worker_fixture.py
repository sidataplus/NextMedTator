"""Real WASM worker regression checks with tiny synthetic, non-clinical ONNX graphs."""
import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / 'tests/fixtures/gliner-worker.json').read_text())
NOTE = FIXTURE['reference']['text']


def package_bytes(expected=None, structured=False):
    files = {name: base64.b64decode(data) for name, data in FIXTURE['graphs'].items()
             if structured or name != 'explicit.onnx'}
    files['tokenizer.json'] = json.dumps(FIXTURE['tokenizer']).encode()
    files['config.json'] = json.dumps(FIXTURE['config']).encode()
    reference = dict(FIXTURE['reference'])
    if expected is not None:
        reference['expected'] = expected
    files['reference.json'] = json.dumps(reference).encode()
    manifest = {
        'format': 'nextmedtator-model-v1', 'id': 'synthetic-worker-test', 'version': '1',
        'runtime': 'onnxruntime-web', 'runtimeVersion': '1.23.2',
        'lineage': {'base': {'model': 'synthetic-test-not-gliner', 'revision': 'a' * 40}},
        'license': {'id': 'Apache-2.0', 'notice': FIXTURE['notice']},
        'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                   'role': 'graph' if name.endswith('.onnx') else 'tokenizer' if name == 'tokenizer.json'
                   else 'fixture' if name == 'reference.json' else 'schema'} for name, data in files.items()],
        'variants': [{'id': 'wasm', 'backend': 'wasm', 'precision': 'fp32',
                      'codec': 'gliner25-boundary-structured-v1' if structured else 'gliner25-boundary-span-v1',
                      'graph': 'encoder.onnx', 'graphs': {'encoder': 'encoder.onnx', 'boundary': 'boundary.onnx',
                                                         **({'explicit': 'explicit.onnx'} if structured else {})},
                      'tokenizer': 'tokenizer.json', 'modelConfig': 'config.json', 'fixtures': ['reference.json']}],
        'capabilities': ['*']
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def check_worker_regressions(page):
    # The real app worker, ORT WASM, tokenizer, boundary and explicit graphs execute.
    # No model outputs are substituted in the page or worker.
    page.evaluate('''() => {
        const NativeWorker = window.Worker;
        window.__workerEvidence = {starts: 0, stops: 0, messages: []};
        window.Worker = class extends NativeWorker {
            constructor(...args) { super(...args); window.__workerEvidence.starts++; }
            postMessage(message, ...args) {
                window.__workerEvidence.messages.push({task: message.task, files: !!message.files});
                super.postMessage(message, ...args);
            }
            terminate() { window.__workerEvidence.stops++; super.terminate(); }
        };
    }''')
    run = '''async bytes => {
        const {importModelPackage, ConformanceWorker} = await import('/app/nextmedtator/model-package.mjs');
        return new ConformanceWorker().run(await importModelPackage(new Uint8Array(bytes)), 'wasm');
    }'''
    reference = FIXTURE['reference']['expected']
    report = page.evaluate(run, list(package_bytes()))
    assert report['pass'], report
    assert [(s['start'], s['end']) for s in report['results'][0]['spans']] == [(15, 23), (44, 52)]
    extra = page.evaluate(run, list(package_bytes(reference[:1])))
    assert not extra['pass'] and len(extra['results'][0]['unexpected']) == 1, extra
    missing = page.evaluate(run, list(package_bytes(reference + reference[:1])))
    assert not missing['pass'] and len(missing['results'][0]['missing']) == 1, missing
    misplaced = page.evaluate(run, list(package_bytes(reference[:1] * 2)))
    assert not misplaced['pass'] and len(misplaced['results'][0]['missing']) == 1, misplaced
    assert len(misplaced['results'][0]['unexpected']) == 1, misplaced

    # Seed source fixtures with the original sample helper; navigate and review through the UI.
    names = []
    for _ in range(2):
        name = page.evaluate('text => app_hotpot.vpp.add_sample_txt_as_ann(text)._filename', NOTE)
        page.locator('.file-list-item-name', has_text=name).click()
        names.append(name)
    page.get_by_test_id('assist-mode').select_option('blind')
    page.get_by_label('Import model package into the annotation assistance panel').set_input_files({
        'name': 'synthetic-worker.nmt.zip', 'mimeType': 'application/zip', 'buffer': package_bytes(structured=True)
    })
    expect(page.get_by_test_id('assist-message')).to_contain_text('structured package loaded')
    for name in names:
        page.get_by_role('checkbox', name=name, exact=True).check()
    page.evaluate('window.__workerEvidence = {starts: 0, stops: 0, messages: []}')
    page.get_by_test_id('assist-analyze-selected').click()
    expect(page.get_by_test_id('assist-message')).to_contain_text('Local analysis finished')
    evidence = page.evaluate('window.__workerEvidence')
    assert evidence == {'starts': 1, 'stops': 1, 'messages': [
        {'task': 'load', 'files': True}, {'task': 'analyze', 'files': False}, {'task': 'analyze', 'files': False}
    ]}, evidence
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
    expect(page.get_by_test_id('assist-summary')).to_have_count(0)
    expect(page.get_by_test_id('assist-reveal')).to_be_disabled()
    # Switching the selector cannot reveal a protected note.
    page.get_by_test_id('assist-mode').select_option('assisted')
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
    expect(page.get_by_test_id('assist-summary')).to_have_count(0)
    page.get_by_test_id('assist-mode').select_option('blind')
    page.locator('.file-list-item-name', has_text=names[0]).click()
    expect(page.get_by_test_id('assist-document')).to_have_text(names[0])
    page.get_by_test_id('assist-freeze').click()
    frozen = page.evaluate('JSON.stringify([...document.querySelector("nextmedtator-assist").assist.blindSnapshots.values()])')
    page.get_by_test_id('assist-reveal').click()
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(2)
    expect(page.get_by_test_id('assist-suggestion').first).to_contain_text('assertion: present')
    expect(page.get_by_test_id('assist-suggestion').first).to_contain_text('temporality: current')
    expect(page.get_by_test_id('assist-suggestion').first).to_contain_text('experiencer: patient')
    # The second note remains hidden after revealing the first.
    page.locator('.file-list-item-name', has_text=names[1]).click()
    expect(page.get_by_test_id('assist-document')).to_have_text(names[1])
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
    expect(page.get_by_test_id('assist-summary')).to_have_count(0)
    expect(page.get_by_test_id('assist-reveal')).to_be_disabled()
    page.get_by_test_id('assist-mode').select_option('blind')
    page.get_by_test_id('assist-mode').select_option('assisted')
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
    page.locator('.file-list-item-name', has_text=names[0]).click()
    expect(page.get_by_test_id('assist-document')).to_have_text(names[0])
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(2)
    page.get_by_test_id('assist-suggestion').first.get_by_test_id('assist-locate').click()
    assert page.evaluate('app_hotpot.codemirror.getSelection()') == 'diabetes'
    page.get_by_test_id('assist-suggestion').first.get_by_test_id('assist-accept').click()
    page.get_by_test_id('assist-add').click()
    expect(page.locator('.tag-table')).to_contain_text('diabetes')
    assert page.evaluate('JSON.stringify([...document.querySelector("nextmedtator-assist").assist.blindSnapshots.values()])') == frozen
    # Click an old control in the same event turn as navigation, before polling can repaint.
    stale = page.evaluate('''name => {
        const assist = document.querySelector('nextmedtator-assist').assist;
        const run = assist.current().run, before = JSON.stringify(run.decisions);
        const oldReject = assist.root.querySelector('[data-testid="assist-reject"]');
        [...document.querySelectorAll('.file-list-item-name')].find(node => node.textContent.trim() === name).click();
        oldReject.click();
        return {before, after: JSON.stringify(run.decisions)};
    }''', names[1])
    assert stale['before'] == stale['after'], stale
    expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
    page.locator('.file-list-item-name', has_text=names[0]).click()
    expect(page.get_by_test_id('assist-document')).to_have_text(names[0])
    page.get_by_test_id('assist-suggestion').nth(1).get_by_test_id('assist-reject').click()
    assert page.evaluate('document.querySelector("nextmedtator-assist").assist.current().run.records.length') == 2
    assert page.evaluate('!!document.querySelector("nextmedtator-assist").assist.current().run.revealedAt')
    results = ROOT / 'test-results'
    results.mkdir(exist_ok=True)
    page.screenshot(path=str(results / 'legacy-worker-review.png'), full_page=True)
    (results / 'worker-browser-results.json').write_text(json.dumps({
        'scope': 'Real ORT WASM with synthetic constant graphs; no GLiNER quality or clinical qualification claim',
        'exact_occurrence_conformance': True, 'reject_extra_missing_misplaced_occurrences': True,
        'structured_two_note_batch': evidence, 'per_note_freeze_and_reveal': True,
        'preserve_blind_snapshot_after_accept': True
    }, indent=2))
