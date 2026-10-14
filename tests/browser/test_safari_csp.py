"""WebKit/Chromium startup and original menu actions under the production CSP.

WebKit on Windows exercises Safari's engine, not the shipping macOS Safari app.
Report-only Cloudflare monitoring is recorded separately from enforced violations.
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/safari-csp';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_SAFARI_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    results=[]
    for engine in ('webkit','chromium'):
        browser=getattr(p,engine).launch(**({'executable_path':chromium_path()} if engine=='chromium' else {}))
        page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(45000)
        errors=[];requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append(r.url))
        page.add_init_script("""window.cspEvents=[];addEventListener('securitypolicyviolation',e=>cspEvents.push({disposition:e.disposition,directive:e.effectiveDirective,blocked:e.blockedURI,source:e.sourceFile,line:e.lineNumber}));""")
        response=page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        expect(page.get_by_test_id('assist-practice-p10')).to_be_visible()
        # The actual Safari/WebKit startup path lacks showOpenFilePicker.
        if engine=='webkit':assert page.evaluate("typeof window.showOpenFilePicker")=='undefined'
        page.get_by_title('Load a minimal task').click()
        expect(page.get_by_test_id('assist-document')).to_be_visible()
        # Original ribbon menus use action anchors, which must no longer execute JS URLs.
        links=page.locator('a[data-nmt-action-link]:visible')
        assert links.count()>0
        with page.expect_download() as schema_download:
            page.get_by_title('Download the current schema file').click()
        schema_download.value.save_as(str(OUT/f'{engine}-schema.yaml'))
        if engine=='webkit':
            with page.expect_download() as annotation_download:
                page.get_by_title('Due to limited browser support, the current annotation file could only be downloaded.').click()
            annotation_download.value.save_as(str(OUT/'webkit-annotation.xml'))
            assert 'Fatigue' in (OUT/'webkit-annotation.xml').read_text(encoding='utf-8')
        for target in ('#section-1-5','#section-1-4','#section-1-6','#section-1-1'):
            page.locator(f'.tabs-holder a[href="{target}"]').click()
        page.get_by_test_id('assist-mode').select_option('auto')
        page.get_by_test_id('assist-options').locator('summary').first.click()
        page.get_by_test_id('assist-options').locator('summary').first.press('Enter')
        expect(page.get_by_test_id('assist-options')).not_to_have_attribute('open','')
        page.get_by_test_id('assist-mode').select_option('assisted')
        await_font=page.evaluate("document.fonts.ready.then(()=>document.fonts.check('900 16px \"Font Awesome 5 Free\"'))")
        assert await_font,'Original toolbar icon font did not load'
        assert page.get_by_test_id('assist-analyze').locator('[aria-hidden=true]').count()==1
        assert page.locator('a[href^="javascript:"]').count()==0
        page.screenshot(path=str(OUT/f'{engine}-assistance.png'))
        violations=page.evaluate('cspEvents');enforced=[v for v in violations if v['disposition']=='enforce']
        assert not enforced,enforced
        assert not errors,errors
        assert not any('nmt-models.sidata.plus' in u or '.onnx' in u or '/models/catalog.json' in u for u in requests),requests
        results.append({'engine':engine,'version':browser.version,'url':URL,'startupOpens':True,'enforcedCspViolations':enforced,'reportOnlyCount':len(violations)-len(enforced),'modelRequests':0,'iconsLoaded':await_font})
        browser.close()
    (OUT/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
