"""Original annotation screen: import a local structured package and review spans there.

Skips when the package zip is absent. Weights are not in the repository.
"""
from pathlib import Path
import os
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
ZIP = Path('/tmp/gliner/gliner25-structured.nmt.zip')
URL = 'http://127.0.0.1:4175/'
NOTE = 'Her mother has diabetes. The patient denies diabetes.'

def dismiss(page):
    page.wait_for_timeout(700)
    if page.locator('#start-screen').is_visible():
        cont = page.locator('#start-screen a', has_text='Continue')
        if cont.count():
            cont.first.click()
        else:
            page.evaluate('jarvis.ssclose()')
    page.locator('#start-screen').wait_for(state='hidden')

def run():
    if not ZIP.is_file():
        print('skip: structured package is not on this machine')
        return
    server = subprocess.Popen(['python', 'scripts/serve_static.py', '--directory', 'dist', '--port', '4175'], cwd=ROOT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(URL, timeout=1).close()
                break
            except Exception:
                time.sleep(.1)
        else:
            raise RuntimeError('Static legacy preview not available')
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(executable_path=executable if Path(executable).exists() else None, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, record_video_dir='/opt/cursor/artifacts')
            page = context.new_page()
            page.set_default_timeout(360000)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(URL)
            page.locator('#tab_link_annotation').wait_for()
            page.wait_for_function('window.app_hotpot?.vpp != null')
            dismiss(page)
            page.get_by_test_id('assist-mode').wait_for()
            page.get_by_title('Load a minimal task').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            page.locator('#btn_annotation_load_sample .dropdown-toggle').click()
            page.once('dialog', lambda dialog: dialog.accept(NOTE))
            page.get_by_text('Customize a Sample Text', exact=True).click()
            sample = page.locator('.file-list-item-name', has_text='sample-')
            sample.wait_for()
            sample.click()
            page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ZIP))
            expect(page.get_by_test_id('assist-message')).to_contain_text('structured package loaded')
            page.get_by_test_id('assist-analyze').click()
            expect(page.get_by_test_id('assist-suggestion')).to_have_count(2)
            body = page.locator('nextmedtator-assist').inner_text()
            assert 'assertion: negated' in body
            assert 'experiencer: patient' in body
            assert 'temporality: unknown' in body
            assert '0.994' in body and '0.983' in body
            page.get_by_test_id('assist-suggestion').nth(1).get_by_test_id('assist-accept').click()
            expect(page.get_by_test_id('assist-suggestion').nth(1)).to_contain_text('assertion = negated')
            page.get_by_label('certainty').select_option('negated')
            page.get_by_test_id('assist-add').click()
            expect(page.locator('.tag-table')).to_contain_text('diabetes')
            expect(page.locator('.tag-table')).to_contain_text('negated')
            expect(page.get_by_test_id('assist-decision')).to_contain_text('Added to the annotation')
            page.get_by_test_id('assist-suggestion').nth(0).get_by_test_id('assist-locate').click()
            selected = page.evaluate('app_hotpot.codemirror.getSelection()')
            assert selected == 'diabetes', selected
            page.get_by_test_id('assist-suggestion').nth(0).get_by_test_id('assist-reject').click()
            expect(page.get_by_test_id('assist-decision').nth(0)).to_contain_text('Rejected')
            page.get_by_test_id('assist-mode').select_option('blind')
            expect(page.get_by_test_id('assist-suggestion')).to_have_count(0)
            page.get_by_role('link', name='Statistics').click()
            page.locator('#tab_link_annotation').click()
            expect(page.locator('.tag-table')).to_contain_text('diabetes')
            page.screenshot(path='/opt/cursor/artifacts/legacy-gliner-annotation.png', full_page=False)
            assert errors == [], errors
            context.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)

if __name__ == '__main__':
    run()
