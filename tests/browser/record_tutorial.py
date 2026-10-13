"""Capture real, fictional-note tutorial steps and validate both local adapters.

Requires work/p10.nmt-model.zip and work/bpsd.nmt-model.zip. Run after a
production build. No mocked inference or reconstructed screenshots.
"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tutorial/images';OUT.mkdir(parents=True,exist_ok=True)
TEMP=ROOT/'temp/browser-validation/tutorial';TEMP.mkdir(parents=True,exist_ok=True)
URL='http://127.0.0.1:4291/'
server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4291'],cwd=ROOT)
try:
    for _ in range(100):
        try:urllib.request.urlopen(URL,timeout=1).close();break
        except OSError:time.sleep(.1)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chromium_path())
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        page=context.new_page();page.set_default_timeout(60000);expect.set_options(timeout=60000)
        errors=[];requests=[];shots=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append({'url':r.url,'method':r.method,'body':r.post_data}))
        page.on('dialog',lambda d:d.accept())
        def capture(name,caption):
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT/(name+'.png')))
            shots.append({'file':name+'.png','caption':caption})
            print('Captured '+name,flush=True)
        def disclosure(name,opened=True):
            loc=page.get_by_test_id('assist-'+name)
            if (loc.get_attribute('open') is not None)!=opened:loc.locator('summary').click()
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        capture('01-start','1. Open NextMedTator — model downloads are opt-in')
        page.get_by_test_id('assist-practice-p10').click()
        expect(page.get_by_test_id('assist-document')).to_have_text('p10-practice.txt.xml')
        expect(page.get_by_test_id('assist-mode')).to_have_value('assisted')
        assert not any('.onnx' in r['url'] or 'nmt-models.' in r['url'] for r in requests)
        capture('02-p10-practice','2. Choose P10 clinical evidence — fictional note and schema included')
        page.get_by_role('button',name='Show approved public model',exact=True).click()
        page.get_by_role('button',name='Download and install clinical-evidence-p10-base-r2',exact=True).scroll_into_view_if_needed()
        capture('03-model-options','3. Request a public model download, or import a local package')
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work/p10.nmt-model.zip'))
        expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded',timeout=600000)
        disclosure('packages',False)
        page.get_by_test_id('assist-analyze').click()
        expect(page.get_by_test_id('loading-progress')).to_be_visible()
        capture('04-analyzing','4. Analyze the note locally using WASM')
        page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy',timeout=600000)
        expect(page.get_by_test_id('assist-suggestion')).to_have_count(2)
        assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==0
        page.get_by_test_id('assist-suggestion').first.scroll_into_view_if_needed()
        capture('05-suggestions','5. Inspect suggestions — the source annotation is unchanged')
        page.get_by_test_id('assist-accept').first.click()
        page.get_by_test_id('assist-add').scroll_into_view_if_needed()
        capture('06-review-fields','6. Check the entity and attributes before writing an annotation')
        page.get_by_test_id('assist-add').click()
        expect(page.get_by_test_id('assist-decision')).to_contain_text('Added to the annotation')
        assert page.evaluate('app_hotpot.vpp.$data.anns[0].tags.length')==1
        capture('07-annotation','7. Write the reviewed annotation; retain the original machine suggestion')
        with page.expect_download() as dl:page.get_by_role('button',name='Export evidence project',exact=True).click()
        bundle=TEMP/'p10-reviewed.nmt.zip';dl.value.save_as(str(bundle))
        page.get_by_test_id('open-workspace').click()
        page.get_by_label('Open project/files',exact=True).set_input_files(str(bundle))
        expect(page.get_by_test_id('human-record')).to_have_count(1)
        capture('08-reopened','8. Export and reopen the evidence project with its review history')
        page.get_by_role('button',name='Back to annotation',exact=True).click()
        page.get_by_test_id('assist-collapse').click()
        page.get_by_test_id('corpus-search-open').click()
        page.get_by_test_id('corpus-search-input').fill('fever')
        page.get_by_test_id('corpus-search-submit').click()
        expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1)
        capture('09-search','9. Search the corpus locally')
        page.get_by_test_id('corpus-search-close').click()
        page.get_by_role('link',name='Statistics').click()
        capture('10-statistics','10. Inspect annotation statistics')
        page.locator('#tab_link_annotation').click();page.get_by_test_id('assist-expand').click()
        disclosure('recovery')
        page.get_by_test_id('assist-recovery-enable').click()
        expect(page.get_by_test_id('assist-recovery-status')).to_contain_text('verified')
        page.get_by_test_id('assist-recovery').scroll_into_view_if_needed()
        capture('11-recovery','11. Enable browser recovery explicitly; keep an exported backup')
        disclosure('practice');page.get_by_test_id('assist-practice-bpsd').click()
        expect(page.get_by_test_id('assist-document')).to_have_text('bpsd-practice.txt.xml')
        assert page.evaluate('!document.querySelector("nextmedtator-assist").assist.recoverySession.enabled')
        disclosure('packages')
        page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work/bpsd.nmt-model.zip'))
        expect(page.get_by_test_id('assist-message')).to_contain_text('package loaded',timeout=600000)
        disclosure('packages',False);disclosure('recovery',False);disclosure('practice',False)
        page.get_by_test_id('assist-mode').select_option('auto')
        page.get_by_test_id('assist-analyze').click()
        page.wait_for_function('()=>!document.querySelector("nextmedtator-assist").assist.busy',timeout=600000)
        tags=page.evaluate('app_hotpot.vpp.$data.anns[0].tags')
        reference=json.loads((ROOT/'work/bpsd-export.json').read_text(encoding='utf-8'))
        expected=next(n for n in reference['native'] if n['records'])['records']
        assert len(tags)==len(expected)==5,(tags,page.get_by_test_id('assist-message').text_content())
        for row in expected:
            hit=next(t for t in tags if t['tag']==row['family'] and t['text']==row['anchor'][0]['text'])
            for field,value in row['fields'].items():assert hit[field]==value
        page.get_by_test_id('assist-suggestion').first.scroll_into_view_if_needed()
        capture('12-bpsd','12. Try BPSD — auto-applied predictions remain unreviewed')
        assert not errors,errors
        assert all(r['method']=='GET' and r['body'] is None and r['url'].startswith(URL) for r in requests),requests
        (TEMP/'report.json').write_text(json.dumps({'browser':browser.version,'localUrl':URL,'crossOriginIsolated':page.evaluate('crossOriginIsolated'),'errors':errors,'requests':len(requests),'noNetworkModels':True,'p10AssistedReviewExportReopen':True,'bpsdExactAutoApply':True,'searchAndRecovery':True,'clinicalValidation':False,'shots':shots},indent=2),encoding='utf-8')
        print('Tutorial workflow passed',flush=True);browser.close()
finally:
    server.terminate();server.wait(timeout=5)
