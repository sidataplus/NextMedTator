"""Smoke gate on the real upstream UI after dependency/template changes."""
from pathlib import Path
import json
import os
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
URL='http://127.0.0.1:4174/'

def run():
    server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4174'],cwd=ROOT)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Static legacy preview not available')
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            page=browser.new_page();errors=[];requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append(r.url))
            page.goto(URL);page.locator('#tab_link_annotation').wait_for();page.wait_for_function('window.app_hotpot?.vpp != null')
            page.wait_for_timeout(500)
            assert errors==[],errors
            assert all(r.startswith(URL) for r in requests),requests
            if page.locator('nextmedtator-workspace').count():
                page.get_by_test_id('open-workspace').click();page.get_by_test_id('sample').wait_for()
                page.get_by_role('button',name='Back to MedTator',exact=True).click()
                page.locator('#tab_link_annotation').wait_for()
            browser.close()
    finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
