"""Focused model-selector browser check; uses the static local preview only."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect
from test_preview import RESULTS, URL, server
from gliner_worker_fixture import package_bytes


def run():
    RESULTS.mkdir(exist_ok=True)
    with server(), sync_playwright() as playwright:
        executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
        browser = playwright.chromium.launch(
            executable_path=executable if Path(executable).exists() else None,
            args=['--no-sandbox']
        )
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
        page.on('request', lambda request: requests.append((request.method, request.url)))
        page.goto(URL)
        page.get_by_test_id('sample').click()
        page.get_by_test_id('source').wait_for()

        assert page.evaluate('localStorage.length') == 0
        assert page.evaluate('async()=> (await indexedDB.databases()).length') == 0
        page.get_by_role('button', name='Models', exact=True).click()
        selector = page.get_by_test_id('workspace-model-source')
        expect(selector).to_have_value('clinical-v3-small')
        expect(page.get_by_test_id('workspace-model-status')).to_contain_text('No matching ONNX package is active')

        for width, height in [(1440, 1000), (375, 812)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.get_by_text('Local export command', exact=True).click()
            metrics = page.evaluate('''()=>{
                const root=document.querySelector('nextmedtator-workspace').shadowRoot;
                const section=root.querySelector('.model-selection');
                const details=section.querySelector('details');
                const select=section.querySelector('select');
                return {section:section.clientWidth,sectionScroll:section.scrollWidth,
                    details:details.clientWidth,detailsScroll:details.scrollWidth,
                    select:select.clientWidth,selectScroll:select.scrollWidth,viewport:innerWidth};
            }''')
            assert metrics['section'] > 0 and metrics['sectionScroll'] <= metrics['section'] + 1, metrics
            assert metrics['detailsScroll'] <= metrics['details'] + 1, metrics
            assert metrics['selectScroll'] <= metrics['select'] + 1, metrics
            assert metrics['section'] <= metrics['viewport'], metrics
            page.screenshot(path=str(RESULTS / f'model-selection-{width}.png'), full_page=True)
            page.get_by_text('Local export command', exact=True).click()

        assert page.evaluate('localStorage.length') == 0
        assert page.evaluate('async()=> (await indexedDB.databases()).length') == 0

        page.get_by_test_id('threshold').evaluate('''input=>{
            input.value='0.73';
            input.dispatchEvent(new Event('input',{bubbles:true}));
        }''')
        selector = page.get_by_test_id('workspace-model-source')
        selector.select_option('custom-huggingface')
        page.get_by_test_id('workspace-model-repository').fill('owner/custom-clinical-adapter')
        page.get_by_test_id('workspace-model-revision').fill('a' * 40)
        page.get_by_test_id('workspace-model-baseModel').fill('fastino/gliner2.5-small-v1')
        page.get_by_test_id('workspace-model-baseRevision').fill('7132dc4561c3f94563c6147e75ffa8ef34c4964a')
        page.get_by_role('button', name='Use this Hugging Face adapter').click()
        expect(page.get_by_test_id('workspace-model-export-command')).to_contain_text("--selection 'huggingface-adapter'")
        command = page.get_by_test_id('workspace-model-export-command').text_content()
        assert "--selection 'huggingface-adapter'" in command, command
        assert "--adapter-repository 'owner/custom-clinical-adapter'" in command, command
        assert "--adapter-revision '" + 'a' * 40 + "'" in command, command

        selector = page.get_by_test_id('workspace-model-source')
        selector.select_option('local-adapter')
        page.get_by_test_id('workspace-model-local-files').set_input_files(
            str(Path(__file__).parent / 'fixtures' / 'local-adapter')
        )
        page.get_by_role('button', name='Use local adapter files').click()
        expect(page.get_by_test_id('workspace-model-export-command')).to_contain_text("--selection 'local-adapter'")
        command = page.get_by_test_id('workspace-model-export-command').text_content()
        assert "--selection 'local-adapter'" in command, command
        assert "--adapter '/path/to/adapter-directory'" in command, command
        assert "--base-model 'fastino/gliner2.5-small-v1'" in command, command

        selector = page.get_by_test_id('workspace-model-source')
        selector.select_option('clinical-v3-small')
        expect(page.get_by_test_id('threshold')).to_have_value('0.73')
        page.evaluate('''async()=>{
            const workspace=document.querySelector('nextmedtator-workspace').workspace;
            const {ReviewProject}=await import('/app/nextmedtator/project.mjs');
            const next=await ReviewProject.create(workspace.project.current.documents,workspace.project.current.schema,{actor:'threshold-regression'});
            await workspace.adopt(next);
            workspace.render();
        }''')
        expect(page.get_by_test_id('threshold')).to_have_value('0.73')

        page.evaluate('''()=>{
            const workspace=document.querySelector('nextmedtator-workspace').workspace;
            const manifest={id:'installed-matching-fixture',version:'synthetic-test',license:{id:'LicenseRef-Synthetic-Test'},variants:[],lineage:{base:{model:'fastino/gliner2.5-small-v1',revision:'7132dc4561c3f94563c6147e75ffa8ef34c4964a'}}};
            const candidate={manifest,manifestHash:'c'.repeat(64),files:new Map()};
            workspace.modelStore={listExisting:async()=>[{manifest,manifestHash:candidate.manifestHash,bytes:1}],read:async()=>candidate};
        }''')
        selector.select_option('original-small')
        expect(page.get_by_test_id('workspace-model-status')).to_contain_text('Active package: installed-matching-fixture')

        page.evaluate('''()=>{
            const workspace=document.querySelector('nextmedtator-workspace').workspace;
            const manifest={id:'late-installed-fixture',lineage:{base:{model:'fastino/gliner2.5-base-v1',revision:'ca906247640776a07753514055be9726f9080ead'}}};
            const candidate={manifest,manifestHash:'d'.repeat(64),files:new Map()};
            window.__lateCandidate=candidate;
            workspace.modelStore={
                listExisting:async()=>[{manifest,manifestHash:candidate.manifestHash,bytes:1}],
                read:async()=>{window.__lateReadPending=true;return new Promise(resolve=>{window.__resolveLateRead=resolve;});}
            };
        }''')
        selector.select_option('original-base')
        page.wait_for_function('window.__lateReadPending === true')
        page.get_by_label('Import local model package').set_input_files({
            'name': 'synthetic-worker.nmt.zip', 'mimeType': 'application/zip', 'buffer': package_bytes(structured=True)
        })
        expect(page.get_by_test_id('message')).to_contain_text('structured package loaded')
        imported_id = page.evaluate("document.querySelector('nextmedtator-workspace').workspace.model.manifest.id")
        assert imported_id == 'synthetic-worker-test', imported_id
        page.evaluate('''async()=>{
            window.__resolveLateRead(window.__lateCandidate);
            await new Promise(resolve=>setTimeout(resolve,0));
        }''')
        assert page.evaluate("document.querySelector('nextmedtator-workspace').workspace.model.manifest.id") == imported_id

        page.evaluate('''()=>{
            const workspace=document.querySelector('nextmedtator-workspace').workspace;
            workspace.modelStore={
                listExisting:async()=>[{manifest:{id:'unloaded-fixture',lineage:{base:{model:'fastino/gliner2.5-base-v1',revision:'ca906247640776a07753514055be9726f9080ead'}}},manifestHash:'e'.repeat(64),bytes:1}],
                read:async()=>new Promise(resolve=>{window.__resolveUnloadRead=resolve;window.__unloadReadPending=true;})
            };
            workspace.setSelectedModel({id:'original-base'});
        }''')
        page.wait_for_function('window.__unloadReadPending === true')
        page.evaluate("document.querySelector('nextmedtator-workspace').workspace.unloadModel()")
        page.evaluate('''async()=>{
            window.__resolveUnloadRead({manifest:{id:'unloaded-fixture',lineage:{base:{model:'fastino/gliner2.5-base-v1',revision:'ca906247640776a07753514055be9726f9080ead'}}},manifestHash:'e'.repeat(64),files:new Map()});
            await new Promise(resolve=>setTimeout(resolve,0));
        }''')
        assert page.evaluate("document.querySelector('nextmedtator-workspace').workspace.model") is None

        recovery = page.evaluate('''async()=>{
            const workspace=document.querySelector('nextmedtator-workspace').workspace;
            const {modelSelectionKey,MODEL_PRESETS,setModelSelection,setSelectionThresholdOverride,selectionThresholdOverride,restoreSelectionThresholdOverride}=await import('/app/nextmedtator/model-selection.mjs');
            const source=workspace.modelSelectionState;
            setModelSelection(source,MODEL_PRESETS[0]);
            const currentKey=modelSelectionKey(source.selection);
            setSelectionThresholdOverride(source,0.72);
            const savedKey=currentKey;
            setModelSelection(source,MODEL_PRESETS.find(item=>item.id==='original-base'));
            setSelectionThresholdOverride(source,0.61);
            const current=restoreSelectionThresholdOverride(source,savedKey,0.48);
            const old=restoreSelectionThresholdOverride(source,undefined,0.42);
            const same=restoreSelectionThresholdOverride(source,modelSelectionKey(source.selection),0.55);
            return {current,old,same,threshold:selectionThresholdOverride(source)};
        }''')
        assert recovery == {'current': 0.61, 'old': 0.61, 'same': 0.55, 'threshold': 0.55}, recovery

        assert page.evaluate('async()=> (await indexedDB.databases()).length') == 0
        assert errors == [], errors
        assert all(method == 'GET' and url.startswith(URL) for method, url in requests), requests
        browser.close()
    print('PASS: default selection, custom HF/local adapters, source-bound thresholds, race-safe restoration, and desktop/mobile layout')


if __name__ == '__main__':
    run()
