"""Original Vue/CodeMirror corpus round trip, autosave and native history retention."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];URL='http://127.0.0.1:4182/'

def run():
    (ROOT/'test-results').mkdir(exist_ok=True)
    server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4182'],cwd=ROOT)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            context=browser.new_context();page=context.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
            page.goto(URL);page.wait_for_function('() => window.app_hotpot?.vpp != null');page.evaluate('jarvis.ssclose()')
            page.get_by_title('Load a minimal task').click();page.locator('.file-list-item-name',has_text='doc_01.txt.xml').wait_for()
            seeded=page.evaluate(r'''async()=>{
                const {makeRun}=await import('/app/nextmedtator/project.mjs');
                const {OffsetMap}=await import('/app/nextmedtator/integrity.mjs');
                const dtd=dtd_parser.parse('<!ENTITY name "condition_task">\n<!ELEMENT condition (#PCDATA)>\n<!ATTLIST condition certainty ( present | negated | unknown ) #IMPLIED "unknown">','dtd');
                const data=app_hotpot.vpp.$data;data.anns=[];app_hotpot.set_dtd(dtd);data.dtd=dtd;
                app_hotpot.vpp.add_sample_txt_as_ann('Her mother has diabetes. 👩‍⚕️\r\né');app_hotpot.vpp.add_sample_txt_as_ann('No diabetes.');data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);
                window.assist=document.querySelector('nextmedtator-assist').assist;
                assist.writeAnnotation({anchor:[new OffsetMap(data.anns[0].text).selection(15,23)]},'condition',{certainty:'present'});
                const child=await assist.syncProject(data.anns[0]),doc=child.current.documents[0];
                await child.addRun(await makeRun(child,doc,[],{producer:{kind:'author-demo',name:'Recovery test fixture',version:'1'}}));
                const snapshot=await child.snapshot();
                assist.render();return {run:child.current.runs[0].fingerprint,snapshot:snapshot.hash,texts:data.anns.map(a=>a.text)};
            }''')
            page.get_by_test_id('assist-recovery-enable').click()
            expect(page.get_by_test_id('assist-recovery-status')).to_contain_text('checkpoint verified')
            saved=page.evaluate('''async()=>{const s=assist.recoverySession;return {id:s.projectId,hash:s.store.expected,data:(await s.store.read(s.projectId)).data};}''')
            assert len(saved['data']['documents'])==2
            child=saved['data']['extensions']['legacyWorkspace']['children'][0]['project']
            assert child['runs'][0]['fingerprint']==seeded['run'] and child['snapshots'][0]['hash']==seeded['snapshot']
            assert not child['snapshots'][0]['independent']
            # A direct original-UI edit is observed through Vue, without using recovery controls.
            page.evaluate("app_hotpot.vpp.$data.anns[0].tags[0].certainty='negated'")
            expect(page.get_by_test_id('assist-recovery-status')).to_contain_text('checkpoint verified')
            page.wait_for_function('() => assist.recoverySession.savedRevision === assist.recoverySession.revision && assist.recoverySession.store.expected !== '+json.dumps(saved['hash']))
            edited=page.evaluate('''async()=>{const s=assist.recoverySession;return {id:s.projectId,hash:s.store.expected,data:(await s.store.read(s.projectId)).data};}''')
            assert edited['data']['extensions']['legacyWorkspace']['anns'][0]['tags'][0]['certainty']=='negated'
            page.evaluate('async()=>await assist.recoverySession.disable()');page.reload();page.wait_for_function('() => window.app_hotpot?.vpp != null');page.evaluate('jarvis.ssclose()')
            page.get_by_role('button',name='List saved corpora',exact=True).click()
            page.get_by_role('button',name='Restore corpus '+edited['id'],exact=True).click()
            page.wait_for_function('id => {const a=document.querySelector("nextmedtator-assist").assist;return a.recoverySession.projectId===id&&!a.busy;}',arg=edited['id'])
            restored=page.evaluate('''()=>{const a=document.querySelector('nextmedtator-assist').assist,children=[...a.projects.values()];return {texts:app_hotpot.vpp.$data.anns.map(n=>n.text),value:app_hotpot.vpp.$data.anns[0].tags[0].certainty,run:children[0].current.runs[0].fingerprint,snapshot:children[0].current.snapshots[0].hash,enabled:a.recoverySession.enabled};}''')
            assert restored=={'texts':seeded['texts'],'value':'negated','run':seeded['run'],'snapshot':seeded['snapshot'],'enabled':True},restored
            page.locator('#cm_editor').wait_for();page.locator('#mui_filelist').wait_for();page.locator('#tab_link_annotation').wait_for()
            assert not errors,errors
            result={'originalVueCodeMirrorRetained':True,'multiDocumentRecovery':True,'directVueEditAutosaved':True,'restartRestoresCorpus':True,'nativeRunAndSnapshotHashesPreserved':True,'importedProvenanceRemainsNonIndependent':True,'browser':browser.version}
            (ROOT/'test-results/legacy-recovery.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));browser.close()
    finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':run()
