"""Fabricated synthetic receipt import/review regression; no inference claim."""
from browser_support import chromium_path
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'test-results/native-ids'
URL='http://127.0.0.1:4244/'


def run():
    OUT.mkdir(parents=True,exist_ok=True)
    receipt={'format':'nextmedtator-native-predictions-v1',
             'model':{'repository':'synthetic/import-regression','revision':'a'*40,'runtimeCommit':'b'*40},
             'runtime':{'kind':'fabricated-regression-fixture'},
             'settings':{'maxEncodedTokens':512,'clinicalValidation':False},
             'schema':{'id':'synthetic-import','entities':[{'id':'motor_agitation','label':'Motor agitation'}],
                       'attributes':[{'label':'certainty','appliesTo':['motor_agitation'],'values':[{'label':'confirmed'}]}]},
             'notes':[{'id':'synthetic-example','text':'Example behavior.','encodedTokens':8,'status':'complete',
                       'result':{'entities':{'Motor agitation':[{'start':8,'end':16,'text':'behavior','confidence':.9,
                                                               'certainty':{'label':'certainty: confirmed','confidence':.8}}]}}}]}
    source=OUT/'source.json';bundle=OUT/'source.nmt.zip';source.write_text(json.dumps(receipt))
    # Remove only this test's previous output; the importer must still refuse overwrites.
    bundle.unlink(missing_ok=True)
    subprocess.run(['node','scripts/import_native_predictions.mjs',str(source),str(bundle)],cwd=ROOT,check=True,capture_output=True)
    server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','preview','--port','4244'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Preview server did not start')
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=chromium_path(),args=['--no-sandbox'])
            page=browser.new_page(accept_downloads=True)
            page.set_default_timeout(30000);errors=[];requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append((r.method,r.url)))
            page.goto(URL);page.get_by_label('Open local documents or project',exact=True).set_input_files(str(bundle))
            suggestion=page.get_by_test_id('suggestion');expect(suggestion).to_have_count(1)
            expect(suggestion).to_contain_text('Motor agitation')
            expect(suggestion).to_contain_text('certainty: confirmed')
            state=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
            assert state['runs'][0]['records'][0]['family']=='motor_agitation'
            suggestion.get_by_role('button',name='Accept',exact=True).click()
            expect(page.get_by_test_id('human-record')).to_have_count(1)
            with page.expect_download() as download:page.get_by_test_id('save').click()
            reviewed=OUT/'reviewed.nmt.zip';download.value.save_as(str(reviewed))
            page.get_by_label('Open project/files',exact=True).set_input_files(str(reviewed))
            expect(page.get_by_test_id('human-record')).to_have_count(1)
            expect(page.get_by_test_id('human-record')).to_contain_text('Motor agitation')
            state=page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current')
            assert state['draft']['records'][0]['family']=='motor_agitation'
            assert not errors,errors
            assert all(method=='GET' and url.startswith(URL) for method,url in requests)
            report={'browser':browser.version,'syntheticReceiptOnly':True,'inferenceTested':False,
                    'sourceIdsRetained':True,'displayLabelsRetained':True,'attributesRetained':True,
                    'acceptExportReopen':True,'noEgress':True}
            (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
    finally:server.terminate();server.wait(timeout=5)


if __name__=='__main__':run()
