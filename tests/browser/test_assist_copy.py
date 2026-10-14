"""Keep Assistance copy and chrome consistent with the original MedTator UI.

MedTator uses Title Case captions and headings without trailing periods,
calls documents "files", and separates side panels with 5px #e9e9e9 splitters.
"""
import sys,time,json,re,subprocess,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path

root=Path(__file__).resolve().parents[2];url='http://127.0.0.1:4289/'
out=root/'temp/browser-validation/assistance-copy';out.mkdir(parents=True,exist_ok=True)
SMALL={'a','an','and','as','at','by','for','in','of','on','or','the','to','with','from','into','per'}
COLLECT='''()=>{const root=document.querySelector('nextmedtator-assist').shadowRoot,dock=root.querySelector('.dock');
const visible=e=>e.getClientRects().length>0,text=e=>e.textContent.replace(/\\s+/g,' ').trim();
const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').replace(/\\s+/g,' ').trim();
return {captions:[...dock.querySelectorAll('h3,summary,button,label>span')].filter(visible).map(e=>e.matches('summary')?own(e):text(e)).filter(Boolean),
options:[...dock.querySelectorAll('[data-testid=assist-mode] option,[data-testid=assist-execution] option,[data-testid=assist-batch-cpu] option,[data-testid=assist-precision] option')].map(text),
titles:[...dock.querySelectorAll('[title]')].map(e=>e.getAttribute('title')),
labels:[...dock.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')),
all:dock.innerText};}'''

def title_case_problems(caption):
    """Return words that break MedTator's Title Case caption style."""
    if caption.endswith('?'):return []  # help links are questions, as in "How to use?"
    caption=re.sub(r'\([^)]*\)','',caption)  # parenthetical details are free text, as in "(.xml)"
    words=re.findall(r"[A-Za-z][\w'.\-]*",caption)
    bad=[]
    for index,word in enumerate(words):
        if index and word.lower() in SMALL:continue
        if re.search(r'[\d._\-]',word):continue  # identifiers such as p10-fp16-r2 or .txt
        if word[0].islower():bad.append(word)
    return bad

def check(page,stage):
    data=page.evaluate(COLLECT)
    problems=[]
    for caption in data['captions']+data['options']:
        if caption.endswith('.') and not caption.endswith('...'):problems.append(('trailing period',caption))
        bad=title_case_problems(caption)
        if bad:problems.append(('not Title Case',caption,bad))
    for value in data['all'].splitlines()+data['titles']+data['labels']:
        if re.search(r'\bnotes?\b',value,re.I):problems.append(('says note instead of file',value))
    assert not problems,(stage,problems)
    return data

server=subprocess.Popen([sys.executable,'scripts/serve_static.py','--directory','dist','--port','4289'],cwd=root)
try:
    for _ in range(100):
        try:urllib.request.urlopen(url,timeout=1).close();break
        except OSError:time.sleep(.1)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=chromium_path());page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
        expect.set_options(timeout=30000);page.goto(url);expect(page.locator('#start-screen')).to_be_hidden()
        host=page.locator('nextmedtator-assist')
        chrome=host.evaluate('''h=>{const s=getComputedStyle(h),dock=getComputedStyle(h.shadowRoot.querySelector('.dock'));
            return {border:s.borderLeftWidth,borderColor:s.borderLeftColor,background:s.backgroundColor,font:dock.fontFamily,bodyFont:getComputedStyle(document.body).fontFamily};}''')
        assert chrome['border']=='5px' and chrome['borderColor']=='rgb(233, 233, 233)',chrome
        assert chrome['background']=='rgb(255, 255, 255)',chrome
        assert chrome['font']==chrome['bodyFont'],chrome
        stages={'empty':check(page,'empty')}
        page.get_by_test_id('assist-practice-p10').click()
        expect(page.get_by_test_id('assist-document')).to_have_text('p10-practice.txt.xml')
        page.get_by_test_id('assist-more').locator(':scope > summary').click()
        for key in ['download-options','local-packages','batch','options','recovery','collections','practice']:
            section=page.get_by_test_id('assist-'+key)
            if section.get_attribute('open') is None:section.locator(':scope > summary').click()
        practice=page.get_by_test_id('assist-practice')
        expect(practice.get_by_test_id('assist-practice-p10')).to_be_visible()
        stages['p10']=check(page,'p10')
        for mode in ['auto','assisted','blind']:
            page.get_by_test_id('assist-mode').select_option(mode);check(page,mode)
        page.get_by_test_id('assist-collapse').click()
        rail=page.get_by_test_id('assist-expand');expect(rail).to_have_text(re.compile('^Assistance$'))
        rail.click()
        page.locator('nextmedtator-assist').screenshot(path=str(out/'panel.png'))
        assert not errors,errors
        (out/'report.json').write_text(json.dumps({'chrome':chrome,'captions':stages['p10']['captions']},indent=2),encoding='utf-8')
        print('Assistance copy follows MedTator conventions',flush=True);browser.close()
finally:server.terminate();server.wait(timeout=5)
