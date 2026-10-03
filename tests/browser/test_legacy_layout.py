"""Keep original ribbon controls and the assistance body reachable on desktop sizes."""
from pathlib import Path
import json, os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
URL = 'http://127.0.0.1:4186/'

def run():
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'dist', '--port', '4186'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('Static app did not start')
        with sync_playwright() as p:
            executable = Path(os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
            browser = p.chromium.launch(executable_path=str(executable) if executable.exists() else None, args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(URL)
            page.wait_for_function('() => !!window.app_hotpot?.vpp')
            page.evaluate('() => jarvis.ssclose()')
            page.get_by_title('Load a minimal task', exact=True).click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').click()
            screenshots = ROOT / 'test-results' / 'responsive-ui'
            screenshots.mkdir(parents=True, exist_ok=True)
            results = []
            for width, height in [(1920, 1080), (1440, 1000), (1366, 768), (1280, 768), (1024, 768), (1440, 600)]:
                page.set_viewport_size({'width': width, 'height': height})
                for tab in ['#section-1-1', '#section-1-5', '#section-1-4', '#section-1-6', '#section-1-2', '#section-1-7']:
                    page.locator(f'a[href="{tab}"]').click()
                    page.wait_for_timeout(100)
                    geometry = page.evaluate('''() => {
                        const nav=document.querySelector('#app_hotpot > nav'), nr=nav.getBoundingClientRect();
                        const controls=[...nav.querySelectorAll('.tabs-holder a, #app_info a, .section.active button, .section.active input, .section.active select')]
                            .filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden');
                        const clipped=controls.filter(e=>{const r=e.getBoundingClientRect();return r.x < -1 || r.right > innerWidth+1 || r.bottom > nr.bottom+1}).map(e=>e.title || e.textContent.trim());
                        const tabs=nav.querySelector('.tabs-holder').getBoundingClientRect(), info=nav.querySelector('#app_info').getBoundingClientRect();
                        const main=[...document.querySelectorAll('.main-ui')].find(e=>e.getClientRects().length);
                        const mr=main.getBoundingClientRect();
                        return {clipped,menuWidth:nr.width,menuHeight:nr.height,tabsOverlap:tabs.right>info.left+1,mainBottom:mr.bottom,mainTop:mr.top,menuBottom:nr.bottom};
                    }''')
                    assert not geometry['clipped'], (width, height, tab, geometry)
                    assert not geometry['tabsOverlap'], (width, height, tab, geometry)
                    assert geometry['menuWidth'] <= width+1, geometry
                    assert geometry['mainTop'] >= geometry['menuBottom']-1, geometry
                    assert geometry['mainBottom'] <= height-10, (width, height, tab, geometry)
                page.locator('#tab_link_annotation').click()
                page.wait_for_timeout(100)
                expect(page.get_by_test_id('assist-collapse')).to_be_visible()
                layout = page.evaluate('''() => {
                    const rect=s=>document.querySelector(s).getBoundingClientRect();
                    const dock=document.querySelector('nextmedtator-assist'), d=dock.getBoundingClientRect();
                    const body=dock.shadowRoot.querySelector('.body');
                    return {editorWidth:rect('#mui_texteditor').width,bodyHeight:body.clientHeight,dockRight:d.right,tagsBottom:rect('#mui_annlist').bottom};
                }''')
                assert layout['editorWidth'] >= 320, (width, height, layout)
                assert layout['bodyHeight'] >= 80, (width, height, layout)
                assert layout['dockRight'] <= width, layout
                assert layout['tagsBottom'] <= height, layout
                if (width, height) in [(1366, 768), (1024, 768), (1440, 600)]:
                    page.get_by_test_id('assist-analyze').evaluate("button => button.scrollIntoView({block:'nearest'})")
                    page.wait_for_timeout(500)
                    page.screenshot(path=str(screenshots / f'assistance-{width}x{height}.png'))
                page.get_by_test_id('open-workspace').evaluate("button => button.scrollIntoView({block:'nearest'})")
                expect(page.get_by_test_id('open-workspace')).to_be_visible()
                page.get_by_test_id('assist-collapse').click()
                expect(page.get_by_test_id('assist-expand')).to_be_visible()
                if (width, height) == (1366, 768):
                    page.screenshot(path=str(screenshots / 'annotation-1366x768.png'))
                page.get_by_test_id('assist-expand').click()
                results.append({'viewport': [width, height], **layout})
            # Actual menus remain usable when their group has wrapped to a second row.
            page.set_viewport_size({'width': 1024, 'height': 768})
            page.get_by_title('Edit current schema or create a new schema', exact=True).click()
            expect(page.locator('#schema_editor')).to_be_visible()
            page.get_by_title('Close schema editor', exact=True).click()
            page.locator('#app_info a', has_text='Settings').click()
            page.wait_for_function('() => app_hotpot.vpp.$data.cfg.enable_show_settings')
            assert not errors, errors
            (ROOT/'test-results').mkdir(exist_ok=True)
            (ROOT/'test-results/legacy-layout.json').write_text(json.dumps({'browser':browser.version,'viewports':results,'errors':errors}, indent=2))
            print('Original UI responsive layout passed on six desktop sizes', flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

if __name__ == '__main__':
    run()
