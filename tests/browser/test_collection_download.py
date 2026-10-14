"""Export and restore with no save-file picker, denied picker, and cancelled picker."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import chromium_path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'temp/browser-validation/collection-download';OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('NMT_DOWNLOAD_URL','http://127.0.0.1:4299/')
with sync_playwright() as p:
    engine=os.environ.get('NMT_BROWSER','chromium')
    browser=getattr(p,engine).launch(**({'executable_path':chromium_path()} if engine=='chromium' else {}))
    results=[]
    for mode in ('unsupported','denied','cancelled'):
        context=browser.new_context(viewport={'width':1440,'height':1000})
        picker='undefined' if mode=='unsupported' else "async()=>{throw new DOMException('Test picker outcome','"+('AbortError' if mode=='cancelled' else 'NotAllowedError')+"');}"
        context.add_init_script("Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:"+picker+"});")
        page=context.new_page();page.set_default_timeout(60000);page.on('dialog',lambda d:d.accept())
        errors=[];downloads=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('download',lambda d:downloads.append(d))
        page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden()
        page.get_by_test_id('assist-practice-p10').click()
        page.get_by_text('Large collections · local disk',exact=True).click()
        page.get_by_test_id('assist-collection-import').set_input_files([
            {'name':f'fictional-{i}.txt','mimeType':'text/plain','buffer':f'Fictional synthetic note {i}. Unicode 😀.'.encode()} for i in range(3)])
        expect(page.get_by_test_id('assist-collection-memory')).to_contain_text('3 notes stored')
        if mode=='cancelled':
            page.get_by_test_id('assist-collection-export').click()
            page.wait_for_timeout(300)
            assert not downloads
            assert not page.evaluate("document.querySelector('nextmedtator-assist').assist.busy")
            results.append({'mode':mode,'noDownload':True});context.close();continue
        with page.expect_download() as pending:page.get_by_test_id('assist-collection-export').click()
        target=OUT/f'{mode}.jsonl';pending.value.save_as(str(target))
        records=[json.loads(line) for line in target.read_text(encoding='utf-8').splitlines()]
        assert records[-1]['end'] and records[-1]['count']==3
        assert len([r for r in records if 'row' in r])==3
        page.get_by_test_id('assist-collection-backup-import').set_input_files(str(target))
        page.wait_for_function("()=>{const a=document.querySelector('nextmedtator-assist').assist;return !a.busy&&a.collection?.name.includes('(restored)');}")
        restored=page.evaluate("""async()=>{const a=document.querySelector('nextmedtator-assist').assist;return Promise.all(a.collection.notes.map(async n=>(await a.collectionStore.note(a.collection.id,n._diskKey)).ann.text));}""")
        assert sorted(restored)==[f'Fictional synthetic note {i}. Unicode 😀.' for i in range(3)]
        assert not errors,errors
        page.get_by_test_id('assist-collection-export').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'{mode}.png'))
        results.append({'mode':mode,'notesRestored':3,'bytes':target.stat().st_size});context.close()
    browser.close();(OUT/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
