"""System theme, explicit choices, persistence and readable shadow panels."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/theme';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_THEME_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    results=[]
    for engine in ('chromium','webkit'):
        browser=getattr(p,engine).launch(**({'executable_path':chromium_path()} if engine=='chromium' else {}))
        context=browser.new_context(color_scheme='dark',viewport={'width':1440,'height':1000})
        page=context.new_page();errors=[];requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        expect(page.locator('html')).to_have_attribute('data-theme-preference','system')
        page.get_by_test_id('assist-practice-p10').click()
        page.screenshot(path=str(OUT/f'{engine}-dark.png'))
        colors=page.get_by_test_id('assist-step-note').evaluate('(e)=>({background:getComputedStyle(e).backgroundColor,text:getComputedStyle(e).color})')
        assert colors=={'background':'rgb(25, 29, 35)','text':'rgb(229, 234, 240)'},colors
        page.get_by_text('Settings',exact=True).click()
        expect(page.get_by_test_id('theme-choice')).to_have_value('system')
        page.get_by_test_id('theme-choice').select_option('light')
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.screenshot(path=str(OUT/f'{engine}-settings-light.png'))
        page.reload();expect(page.locator('#start-screen')).to_be_hidden()
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.get_by_text('Settings',exact=True).click();page.get_by_test_id('theme-choice').select_option('system')
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.emulate_media(color_scheme='light');expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.get_by_test_id('theme-choice').select_option('dark')
        page.emulate_media(color_scheme='light');expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.screenshot(path=str(OUT/f'{engine}-settings-dark.png'))
        page.reload();expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-p10').click()
        for name,target in [('statistics','#section-1-5'),('export','#section-1-4'),('annotation','#section-1-1')]:
            page.locator(f'.tabs-holder a[href="{target}"]').click();page.screenshot(path=str(OUT/f'{engine}-{name}.png'))
        page.get_by_test_id('assist-collapse').click();page.get_by_test_id('corpus-search-open').click()
        page.get_by_test_id('corpus-search-input').fill('fever');page.get_by_test_id('corpus-search-submit').click()
        expect(page.get_by_test_id('corpus-search-hit')).to_have_count(1,timeout=120000)
        page.screenshot(path=str(OUT/f'{engine}-search.png'))
        assert not errors,errors
        assert not any('nmt-models.sidata.plus' in u or '.onnx' in u for u in requests)
        results.append({'engine':engine,'version':browser.version,'systemDefault':True,'liveSystemChanges':True,'overridePersists':True,'search':True,'errors':errors})
        context.close()
        blocked=browser.new_context(color_scheme='dark');blocked.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Disabled','SecurityError')}})")
        page=blocked.new_page();page.goto(URL);expect(page.locator('html')).to_have_attribute('data-theme','dark')
        blocked.close();browser.close()
    (OUT/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
