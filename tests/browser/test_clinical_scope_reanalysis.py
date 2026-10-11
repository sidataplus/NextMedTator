"""Reanalyze a real exported scope in the separate evidence workspace."""
import json
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from test_clinical_scope import ROOT, PACKAGE


def run():
    bundle = ROOT/'test-results/clinical-scope-evidence.nmt.zip'
    assert bundle.is_file() and PACKAGE.is_file(), 'Run the actual original-UI scope gate first'
    with zipfile.ZipFile(bundle) as archive:
        original = json.loads(archive.read('project.json'))
        runs = json.loads(archive.read('machine-runs/index.json'))
        source = archive.read(original['documents'][0]['sourceFile']).decode('utf-8')
    url = 'http://127.0.0.1:4196/'
    server = subprocess.Popen(['python','scripts/serve_static.py','--directory','preview','--port','4196'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url,timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1200})
            page.set_default_timeout(180000)
            expect.set_options(timeout=180000)
            errors, requests = [], []
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'body':r.post_data}))
            page.goto(url)
            page.get_by_label('Open local documents or project',exact=True).set_input_files(str(bundle))
            page.get_by_test_id('source').wait_for()
            page.get_by_role('button',name='Models',exact=True).click()
            page.get_by_label('Import local model package',exact=True).set_input_files(str(PACKAGE))
            expect(page.get_by_test_id('message')).to_contain_text('record package loaded')
            page.get_by_role('button',name='Models',exact=True).click()
            page.get_by_test_id('analysis-mode').select_option('assisted')
            page.get_by_test_id('analyze').click()
            page.wait_for_function('''()=>{const w=document.querySelector('nextmedtator-workspace').workspace;return w.project.current.runs.length===3&&!w.busy;}''',timeout=300000)
            project=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
            new=project['runs'][-1]
            assert project['runs'][:2]==runs and new['status']=='complete'
            assert new['settings']['scope']['profile']==original['extensions']['suggestionScope']
            assert new['coverage']==[[0,len(source)]]
            assert len(new['records'])==len(runs[-1]['records'])==1
            assert all(r['family'] in ['event_occurrence','function_occurrence'] and r['conceptId'] in ['care_resistance','mobility_difficulty'] for r in new['records'])
            assert project['draft']==original['draft'], 'Reanalysis must not overwrite accepted/native tags'
            assert not errors,errors
            assert all(r['url'].startswith(url) and r['method']=='GET' and not r['body'] for r in requests)
            (ROOT/'test-results/clinical-scope-reanalysis.json').write_text(json.dumps({'pass':True,'browser':browser.version,
                'savedScopeHonored':True,'oldRunsUnchanged':True,'nativeTagsUnchanged':True,'newPredictions':len(new['records']),
                'schemaHash':new['settings']['scope']['profile']['semanticSchema']['schema_hash'],'noNoteEgress':True},indent=2)+'\n')
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__=='__main__':
    run()
