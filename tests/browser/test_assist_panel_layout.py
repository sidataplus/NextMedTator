"""Keep primary assistance actions reachable and disclosure state stable."""
import sys,time,json,subprocess,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

root=Path(__file__).resolve().parents[2];url='http://127.0.0.1:4288/'
out=root/'temp/browser-validation/assistance-refinement';out.mkdir(parents=True,exist_ok=True)
server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4288'],cwd=root)
try:
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1).close();break
        except OSError:time.sleep(.1)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chromium_path());page=browser.new_page(viewport={'width':1440,'height':900});errors=[];requests=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
        expect.set_options(timeout=30000);page.goto(url);expect(page.locator('#start-screen')).to_be_hidden()
        expect(page.get_by_test_id('assist-analyze')).to_be_disabled()
        expect(page.get_by_test_id('open-workspace')).to_be_disabled()
        page.screenshot(path=str(out/'01-empty.png'))
        page.get_by_title('Load a minimal task').click()
        expect(page.get_by_test_id('assist-analyze')).to_be_disabled()
        batch=page.get_by_test_id('assist-batch');batch.locator('summary').click();batch.locator('input[type=checkbox]').first.check()
        expect(batch).to_have_attribute('open','')
        expect(batch.locator('summary')).to_contain_text('1 selected')
        mode=page.get_by_test_id('assist-mode');description=page.get_by_test_id('assist-mode-description')
        expect(mode).to_have_value('auto')
        assert mode.locator('option').evaluate_all('o=>o.map(x=>x.value)')==['auto','assisted','blind']
        expect(description).to_have_text('Adds model predictions as unreviewed tags.')
        placement=mode.evaluate('''m=>{const label=m.closest('label'),next=label.nextElementSibling,bar=label.parentElement.querySelector('.action-bar');return {next:next?.dataset.testid,described:m.getAttribute('aria-describedby')===next?.id,barText:bar.textContent,gap:next.getBoundingClientRect().top-m.getBoundingClientRect().bottom};}''')
        assert placement['next']=='assist-mode-description' and placement['described'],placement
        assert 'unreviewed' not in placement['barText'] and 'Review each suggestion' not in placement['barText'],placement
        assert 0<=placement['gap']<=8,placement
        mode.select_option('assisted');expect(batch).to_have_attribute('open','')
        expect(description).to_have_text('Review each suggestion before adding it as a tag.')
        mode.select_option('blind');expect(description).to_have_text('Freeze your own annotation before revealing suggestions.')
        mode.select_option('assisted')
        page.get_by_test_id('assist-more').locator(':scope > summary').click()
        options=page.get_by_test_id('assist-options');options.locator('summary').click();options.get_by_role('button',name='Use Default',exact=True).click();expect(options).to_have_attribute('open','')
        options.locator('summary').click();batch.locator('summary').click()
        page.get_by_test_id('assist-recovery').scroll_into_view_if_needed()
        before=page.evaluate('document.querySelector("nextmedtator-assist").shadowRoot.querySelector(".body").scrollTop')
        assert before>0
        page.get_by_test_id('assist-mode').evaluate("e=>{e.value='auto';e.dispatchEvent(new Event('change'))}")
        after=page.evaluate('document.querySelector("nextmedtator-assist").shadowRoot.querySelector(".body").scrollTop')
        assert abs(before-after)<=1,(before,after)
        sizes=[]
        for width,height in [(1440,900),(1024,768),(1440,600)]:
            page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(150)
            page.get_by_test_id('assist-analyze').scroll_into_view_if_needed()
            geometry=page.evaluate('''()=>{const root=document.querySelector('nextmedtator-assist').shadowRoot,action=root.querySelector('[data-testid=assist-analyze]').getBoundingClientRect(),body=root.querySelector('.body');return {top:action.top,bottom:action.bottom,overflow:body.scrollWidth-body.clientWidth};}''')
            assert geometry['top']>=0 and geometry['bottom']<height,geometry
            assert geometry['overflow']<=1,geometry
            page.screenshot(path=str(out/(str(width)+'x'+str(height)+'.png')));sizes.append({'width':width,'height':height,**geometry})
        page.get_by_test_id('assist-collapse').click();expect(page.get_by_test_id('assist-expand')).to_be_visible();page.get_by_test_id('assist-expand').click()
        practice=page.get_by_test_id('assist-practice')
        if practice.get_attribute('open') is None:practice.locator('summary').click()
        page.get_by_test_id('assist-practice-p10').click();expect(page.get_by_test_id('assist-confirm')).to_contain_text('Replace the current files');page.get_by_test_id('assist-confirm-accept').click()
        expect(page.get_by_test_id('assist-document')).to_have_text('p10-practice.txt.xml')
        expect(page.get_by_test_id('assist-mode')).to_have_value('auto')
        page.get_by_test_id('assist-practice-bpsd').click();page.get_by_test_id('assist-confirm-cancel').click();expect(page.get_by_test_id('assist-confirm')).to_have_count(0)
        expect(page.get_by_test_id('assist-document')).to_have_text('p10-practice.txt.xml')
        assert page.evaluate('app_hotpot.vpp.$data.anns.length')==1
        assert not errors,errors
        assert not any('nmt-models.sidata.plus' in u or 'huggingface.co' in u for u in requests),requests
        (out/'report.json').write_text(json.dumps({'sizes':sizes,'disclosureStateRetained':True,'preconditionsDisableAnalyze':True,'defaultMode':'auto','modeDescriptionUnderSelect':True,'modelDownloads':0,'errors':errors},indent=2),encoding='utf-8')
        print('Assistance layout, disclosure state, action preconditions and no-download startup passed',flush=True);browser.close()
finally:server.terminate();server.wait(timeout=5)
