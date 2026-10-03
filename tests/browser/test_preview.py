"""Browser integration checks using real Chromium and no network-dependent fixtures."""
from pathlib import Path
from contextlib import contextmanager
import json
import os
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
RESULTS=ROOT/'test-results'
URL='http://127.0.0.1:4173/'

@contextmanager
def server():
    process=subprocess.Popen(['python','scripts/serve_static.py','--directory','preview'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Preview server did not start')
        yield
    finally:
        process.terminate();process.wait(timeout=5)

def run():
    RESULTS.mkdir(exist_ok=True)
    results=[]
    with server(),sync_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
        browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
        def case(name,fn):
            context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
            page=context.new_page();errors=[];requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'post':r.post_data}))
            try:
                page.goto(URL);page.get_by_test_id('sample').wait_for()
                fn(page,context,requests)
                assert errors==[],errors
                assert all(r['method']=='GET' and r['url'].startswith(URL) for r in requests),requests
                results.append({'name':name,'pass':True,'requests':len(requests)})
            except Exception as e:
                page.screenshot(path=str(RESULTS/(name+'.failure.png')),full_page=True)
                results.append({'name':name,'pass':False,'error':str(e),'pageErrors':errors})
            finally:context.close()
        def assisted(page,context,requests):
            page.get_by_test_id('sample').click()
            assert page.get_by_test_id('analyze').is_enabled()
            page.get_by_test_id('analyze').click()
            expect(page.get_by_test_id('message')).to_contain_text('Import a GLiNER2.5 boundary model package')
            page.get_by_test_id('demo-suggest').click()
            expect(page.get_by_test_id('suggestion')).to_have_count(1)
            page.get_by_test_id('accept').click();expect(page.get_by_test_id('human-record')).to_have_count(1)
            page.get_by_role('button',name='Undo',exact=True).click();expect(page.get_by_test_id('human-record')).to_have_count(0)
            page.get_by_test_id('suggestion').get_by_role('button',name='Edit',exact=True).click()
            page.locator('select[data-field=experiencer]').select_option('family')
            page.get_by_test_id('save-evidence').click();assert 'family' in page.get_by_test_id('human-record').inner_text()
            source=page.get_by_test_id('source');source.evaluate('(n)=>{n.focus();n.setSelectionRange(44,52)}')
            page.get_by_test_id('add-evidence').click();page.locator('input[data-field=concept]').fill('diabetes')
            page.locator('select[data-field=assertion]').select_option('negated')
            page.get_by_test_id('save-evidence').click();expect(page.get_by_test_id('human-record')).to_have_count(2)
            page.get_by_role('button',name='Review completeness',exact=True).click()
            page.get_by_role('checkbox').check();page.get_by_test_id('complete').click()
            page.get_by_test_id('freeze').click()
            with page.expect_download() as saved:page.get_by_test_id('save').click()
            saved.value.save_as(str(RESULTS/'assisted.nmt.zip'))
            page.screenshot(path=str(RESULTS/'assisted.png'),full_page=True)
        case('assisted-review-export',assisted)
        def blind(page,context,requests):
            page.locator('select').select_option('blind');page.get_by_test_id('sample').click()
            expect(page.get_by_test_id('demo-suggest')).to_have_count(0)
            expect(page.get_by_test_id('suggestion')).to_have_count(0)
            page.get_by_test_id('freeze').click();expect(page.get_by_test_id('phase')).to_contain_text('frozen')
            page.get_by_test_id('demo-suggest').click();expect(page.get_by_test_id('suggestion')).to_have_count(0)
            page.get_by_test_id('reveal').click();expect(page.get_by_test_id('suggestion')).to_have_count(1)
            page.get_by_role('button',name='Compare & adjudicate',exact=True).click()
            page.get_by_role('checkbox').check();page.get_by_test_id('machine-snapshot').click()
            page.get_by_role('button',name='Compare snapshots',exact=True).click()
            assert 'disagreement-analysis-not-accuracy' in page.locator('pre').inner_text()
        case('blind-freeze-reveal-compare',blind)
        def local(page,context,requests):
            page.get_by_test_id('sample').click();page.get_by_role('button',name='Privacy & storage',exact=True).click()
            # No recovery keys before opt-in, including no implicit metadata persistence.
            assert page.evaluate('localStorage.length')==0
            assert page.evaluate('async()=> (await indexedDB.databases()).length')==0
            page.on('dialog',lambda d:d.accept())
            page.get_by_test_id('recovery-enable').click()
            # Recovery writes IndexedDB after the click. Locator expectations retry
            # without page-side eval, which the application CSP rejects.
            expect(page.get_by_test_id('save-status')).to_contain_text('Recovery checkpoint saved')
            expect(page.get_by_test_id('save-status')).to_contain_text('Recovery ON')
            page.get_by_role('button',name='Delete recovery & disable',exact=True).click()
            expect(page.get_by_test_id('save-status')).to_contain_text('Recovery OFF')
            page.get_by_role('button',name='Install app for offline use',exact=True).click()
            expect(page.get_by_test_id('message')).to_contain_text('App cache installed')
            page.wait_for_function('() => navigator.serviceWorker.controller !== null')
            context.set_offline(True);page.reload();page.get_by_test_id('sample').wait_for()
            page.get_by_test_id('sample').click();page.get_by_test_id('demo-suggest').click();page.get_by_test_id('accept').click()
            with page.expect_download() as saved:page.get_by_test_id('save').click()
            saved.value.save_as(str(RESULTS/'offline.nmt.zip'))
        case('opt-in-recovery-offline-export',local)
        def canary(page,context,requests):
            canary='NMT_PRIVATE_CANARY_4F8C'
            payload={'name':canary+'.txt','mimeType':'text/plain','buffer':(canary+'\r\n<script>window.__injected=true</script> ไทย 👩‍⚕️').encode()}
            page.get_by_label('Open local documents or project').set_input_files(payload)
            assert canary in page.get_by_test_id('source').input_value()
            assert not page.evaluate('Boolean(window.__injected)')
            assert not any(canary in json.dumps(r) for r in requests)
            with page.expect_download() as saved:page.get_by_test_id('save').click()
            saved.value.save_as(str(RESULTS/'canary.nmt.zip'))
            # Import verifies source hash and exact line endings.
            page.get_by_label('Open project/files').set_input_files(str(RESULTS/'canary.nmt.zip'))
            assert page.get_by_test_id('source').input_value().endswith('ไทย 👩‍⚕️')
            assert not any(canary in json.dumps(r) for r in requests)
        case('local-canary-import-export',canary)
        def xml(page,context,requests):
            result=page.evaluate('''async()=>{const {sourceDocument,OffsetMap}=await import('/app/nextmedtator/integrity.mjs');const {exportMedTator,importMedTator}=await import('/app/nextmedtator/interchange.mjs');const {DEMO_SCHEMA}=await import('/app/nextmedtator/contracts.mjs');const doc=await sourceDocument('xml-fixture',new TextEncoder().encode('first\\r\\nไทย 👩‍⚕️ diabetes'));const m=new OffsetMap(doc.text),start=doc.text.indexOf('diabetes');const r={id:'one',documentId:doc.id,family:'condition_occurrence',anchor:[m.selection(start,start+8)],fields:{concept:'<diabetes & "value">'}};const e=exportMedTator(doc,[r],DEMO_SCHEMA);const i=await importMedTator(e.xml,{documentId:doc.id});return {source:doc.text,roundtrip:i.project.current.documents[0].text,anchor:i.project.current.draft.records[0].anchor[0].text,loss:e.losses.length};}''')
            assert result['source']==result['roundtrip'];assert result['anchor']=='diabetes';assert result['loss']>0
            rejected=page.evaluate('''async()=>{const {importMedTator}=await import('/app/nextmedtator/interchange.mjs');try{await importMedTator('<!DOCTYPE x [<!ENTITY xxe SYSTEM "https://evil.invalid">]><x><TEXT>&xxe;</TEXT><TAGS/></x>');return false;}catch{return true;}}''')
            assert rejected
        case('xml-unicode-roundtrip-and-xxe-rejection',xml)
        browser.close()
    (RESULTS/'browser-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))
    if not all(r['pass'] for r in results):raise SystemExit(1)
if __name__=='__main__':run()
