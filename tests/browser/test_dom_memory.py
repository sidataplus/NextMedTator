"""DOM-only checks on about:blank, without bypassing managed navigation policy.

Hash/UUID functions are injected test doubles because an opaque origin has no
WebCrypto. These checks do NOT validate secure-context, CSP, offline, ORT or IDB.
The real-origin acceptance suite is test_preview.py and remains a release gate.
"""
from pathlib import Path
import hashlib
import json
import os
import uuid
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]

def run():
 results=[]
 with sync_playwright() as p:
  executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
  browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
  def case(name,fn):
   context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=context.new_page();errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
   page.expose_function('__testDigest',lambda data:list(hashlib.sha256(bytes(data)).digest()))
   page.expose_function('__testUUID',lambda:str(uuid.uuid4()))
   try:
    page.set_content('<nextmedtator-workspace standalone></nextmedtator-workspace>')
    page.evaluate('''()=>{Object.defineProperty(crypto,'subtle',{value:{digest:async(_,data)=>new Uint8Array(await window.__testDigest(Array.from(new Uint8Array(data)))).buffer}});let id=0;Object.defineProperty(crypto,'randomUUID',{value:()=>`dom-test-${++id}`});}''')
    page.add_script_tag(content=(ROOT/'test-results/dom-harness.js').read_text())
    page.get_by_test_id('sample').wait_for();fn(page)
    assert errors==[],errors;assert requests==[],requests
    results.append({'name':name,'pass':True,'scope':'DOM-only; hash/UUID test doubles; no network'})
   except Exception as e:
    page.screenshot(path=str(ROOT/'test-results'/f'{name}.dom-failure.png'),full_page=True)
    results.append({'name':name,'pass':False,'error':str(e),'pageErrors':errors})
   finally:context.close()
  def assisted(page):
   page.get_by_test_id('sample').click();page.get_by_test_id('demo-suggest').click();expect(page.get_by_test_id('suggestion')).to_have_count(1)
   page.get_by_test_id('accept').click();expect(page.get_by_test_id('human-record')).to_have_count(1)
   page.get_by_role('button',name='Undo',exact=True).click();expect(page.get_by_test_id('human-record')).to_have_count(0)
   page.get_by_test_id('suggestion').get_by_role('button',name='Edit',exact=True).click();page.locator('select[data-field=experiencer]').select_option('family');page.get_by_test_id('save-evidence').click()
   assert 'family' in page.get_by_test_id('human-record').inner_text()
   note=page.get_by_test_id('source');note.evaluate('(n)=>{n.focus();n.setSelectionRange(44,52)}');page.get_by_test_id('add-evidence').click();page.locator('input[data-field=concept]').fill('diabetes');page.locator('select[data-field=assertion]').select_option('negated');page.get_by_test_id('save-evidence').click();expect(page.get_by_test_id('human-record')).to_have_count(2)
   page.get_by_role('button',name='Review completeness',exact=True).click();page.get_by_role('checkbox',name='I checked the whole document',exact=False).check();page.get_by_test_id('complete').click();page.get_by_test_id('freeze').click()
   page.screenshot(path=str(ROOT/'test-results'/'assisted-dom.png'),full_page=True)
  case('assisted-edit-undo-add-complete',assisted)
  def blind(page):
   page.locator('select').select_option('blind');page.get_by_test_id('sample').click();expect(page.get_by_test_id('demo-suggest')).to_have_count(0)
   page.get_by_test_id('freeze').click();page.get_by_test_id('demo-suggest').click();expect(page.get_by_test_id('suggestion')).to_have_count(0)
   page.get_by_test_id('reveal').click();expect(page.get_by_test_id('suggestion')).to_have_count(1)
   page.get_by_role('button',name='Compare & adjudicate',exact=True).click();page.locator('.details').get_by_role('checkbox').check();page.get_by_test_id('machine-snapshot').click();page.wait_for_function('() => document.querySelector("nextmedtator-workspace").workspace.project.current.snapshots.length===2');report=page.evaluate('async()=>{const p=document.querySelector("nextmedtator-workspace").workspace.project.current;return __testRequire("compare.mjs").compareSnapshots(p.snapshots[0],p.snapshots[1]);}');assert report['interpretation']=='disagreement-analysis-not-accuracy'
  case('blind-freeze-reveal-machine-compare',blind)
  def injection(page):
   canary='NMT_DOM_CANARY'
   page.get_by_label('Open local documents or project').set_input_files({'name':canary+'.txt','mimeType':'text/plain','buffer':(canary+'\r\n<script>window.__injected=true</script> 👩‍⚕️').encode()})
   assert canary in page.get_by_test_id('source').input_value();assert not page.evaluate('Boolean(window.__injected)')
   page.get_by_test_id('source').evaluate('(n)=>{n.focus();n.setSelectionRange(0,14)}');page.get_by_test_id('add-evidence').click();page.locator('input[data-field=concept]').fill('<img src=x onerror="window.__injected=true">');page.get_by_test_id('save-evidence').click();assert not page.evaluate('Boolean(window.__injected)')
  case('untrusted-note-and-field-as-text',injection)
  def xml(page):
   result=page.evaluate('''async()=>{const {sourceDocument,OffsetMap}=__testRequire('integrity.mjs');const {exportMedTator,importMedTator}=__testRequire('interchange.mjs');const {DEMO_SCHEMA}=__testRequire('contracts.mjs');const d=await sourceDocument('xml-test',new TextEncoder().encode('first\\r\\nไทย 👩‍⚕️ diabetes'));const m=new OffsetMap(d.text),a=d.text.indexOf('diabetes');const r={id:'one',documentId:d.id,family:'condition_occurrence',anchor:[m.selection(a,a+8)],fields:{concept:'<diabetes & "value">'}};const e=exportMedTator(d,[r],DEMO_SCHEMA);const i=await importMedTator(e.xml,{documentId:d.id});return {text:d.text,actual:i.project.current.documents[0].text,anchor:i.project.current.draft.records[0].anchor[0].text};}''')
   assert result['text']==result['actual'];assert result['anchor']=='diabetes'
   assert page.evaluate('''async()=>{try{await __testRequire('interchange.mjs').importMedTator('<!DOCTYPE x [<!ENTITY test SYSTEM "https://unused.invalid">]><x><TEXT>&test;</TEXT><TAGS/></x>');return false;}catch{return true;}}''')
  case('browser-xml-crlf-unicode-and-entity-rejection',xml)
  browser.close()
 (ROOT/'test-results/dom-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
 if not all(r['pass'] for r in results):raise SystemExit(1)
if __name__=='__main__':run()
