"""An unopened collection must not trigger a repeating autosave/render loop."""
import os
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
    page=browser.new_page();page.goto(os.environ.get('NMT_IMPROVEMENTS_URL','http://127.0.0.1:4299/'))
    expect(page.locator('#start-screen')).to_be_hidden();page.get_by_test_id('assist-practice-p10').click()
    page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
    page.evaluate("""async()=>{
      const a=document.querySelector('nextmedtator-assist').assist;
      const meta=await a.collectionStore.create(app_hotpot.vpp.$data.dtd,'Synthetic idle check');
      await a.perform(()=>a.openCollection(meta.id,{replaceConfirmed:true}));
      const perform=a.perform.bind(a);a.testIdleCalls=0;a.perform=(action)=>{a.testIdleCalls++;return perform(action);};
    }""")
    page.wait_for_timeout(4200)
    state=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {calls:a.testIdleCalls,dirty:a.collectionDirty,busy:a.busy};}")
    assert state=={'calls':0,'dirty':False,'busy':False},state
    page.evaluate("()=>document.querySelector('nextmedtator-assist').assist.perform(()=>document.querySelector('nextmedtator-assist').assist.closeCollection())")
    page.wait_for_timeout(2500)
    assert page.evaluate("document.querySelector('nextmedtator-assist').assist.testIdleCalls")==1
    print('Unopened and closed collections stay idle without repeated autosave',flush=True);browser.close()
