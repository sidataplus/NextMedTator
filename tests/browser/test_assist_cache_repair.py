"""Corrupt installed P10/BPSD models expose an explicit verified-download repair."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_support import chromium_path

ROOT = Path(__file__).resolve().parents[2]
URL = os.environ.get("NMT_ASSIST_REPAIR_URL", "http://127.0.0.1:4299/")
CATALOG = json.loads((ROOT / "deployment/production-model-catalog.json").read_text())
ENTRY_IDS = {
    "p10": "clinical-evidence-p10-base-r2",
    "bpsd": "bpsd-gliner25-base-r2",
}


def run():
    with sync_playwright() as playwright:
        chrome = chromium_path() or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        browser = playwright.chromium.launch(
            **({"executable_path": chrome} if Path(chrome).is_file() else {})
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        page.set_default_timeout(30000)
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))

        for profile, entry_id in ENTRY_IDS.items():
            page.goto(URL)
            expect(page.locator("#start-screen")).to_be_hidden()
            page.get_by_test_id(f"assist-practice-{profile}").click()
            page.wait_for_function(
                "profile => { const a=document.querySelector('nextmedtator-assist').assist; return !a.busy && a.modelSelection.id===profile; }",
                arg="clinical-p10" if profile == "p10" else "bpsd-base",
            )

            entry = next(item for item in CATALOG["entries"] if item["manifest"]["id"] == entry_id)
            page.evaluate(
                """async ({catalog, entry}) => {
                    const assist = document.querySelector('nextmedtator-assist').assist;
                    const {ModelIntegrityError} = await import('/app/nextmedtator/model-store.mjs');
                    await assist.restoreSelectedModel({epoch:assist.modelSelectionEpoch});
                    assist.catalog = catalog;
                    assist.downloadPrecision = 'fp32';
                    assist.deviceProfile = {gpu:false, fp16:false, cores:8, memory:16};
                    const hash = 'a'.repeat(64);
                    assist.installedModels = [{
                        manifest: entry.manifest,
                        manifestHash: hash,
                        bytes: entry.manifest.files.reduce((total, file) => total + file.bytes, 0)
                    }];
                    assist.modelStore.read = async () => {
                        window.__repairReadAttempts = (window.__repairReadAttempts || 0) + 1;
                        throw new ModelIntegrityError('Injected installed-cache corruption');
                    };
                    const view = window.app_hotpot.vpp.$data;
                    const tagName = Object.keys(view.dtd.tag_dict).find(name => !view.dtd.tag_dict[name].is_non_consuming);
                    assist.writeAnnotation({anchor:[{start:0,end:3,text:view.anns[view.ann_idx].text.slice(0,3)}]}, tagName, {});
                    window.__repairTagsBefore = JSON.stringify(view.anns[view.ann_idx].tags);
                    window.__repairSelectionBefore = assist.modelSelection.id;
                    assist.render();
                }""",
                {"catalog": CATALOG, "entry": entry},
            )

            load = page.get_by_test_id("assist-load-model")
            expect(load).to_have_text("Load Installed " + ("P10" if profile == "p10" else "BPSD"))
            load.click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )

            repair_label = "Repair " + ("P10" if profile == "p10" else "BPSD") + " (FP32)"
            expect(page.get_by_test_id("assist-load-model")).to_have_text(repair_label)
            expect(page.get_by_test_id("assist-message")).to_contain_text("Injected installed-cache corruption")
            assert page.evaluate("window.__repairReadAttempts") == 1
            assert page.evaluate(
                "JSON.stringify(app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags)"
            ) == page.evaluate("window.__repairTagsBefore")
            assert page.evaluate(
                "document.querySelector('nextmedtator-assist').assist.modelSelection.id"
            ) == page.evaluate("window.__repairSelectionBefore")
            expect(page.get_by_test_id("assist-packages")).not_to_contain_text("No download needed")
            expect(page.get_by_test_id("assist-message")).to_have_attribute("role", "alert")

            # The repair action must enter the real verification gate. The test
            # cancels there, before any grant or model artifact request.
            page.get_by_test_id("assist-load-model").click()
            dialog = page.get_by_role("dialog", name="Verify Model Download")
            expect(dialog).to_be_visible()
            expect(dialog.get_by_role("button", name="Cancel Download")).to_be_visible()
            expect(dialog.get_by_role("button", name="Open Verification Tab")).to_be_visible()
            dialog.get_by_role("button", name="Cancel Download").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )
            assert page.evaluate("window.__repairReadAttempts") == 1

            # A missing row is a separate repair condition. An operational
            # storage error remains visible and leaves the cached row usable.
            page.evaluate("""()=>{
                const assist=document.querySelector('nextmedtator-assist').assist;
                assist.unavailableInstalledModels.clear();
                assist.modelStore.read=async()=>null;
                assist.render();
            }""")
            expect(page.get_by_test_id("assist-load-model")).to_have_text(
                "Load Installed " + ("P10" if profile == "p10" else "BPSD")
            )
            page.get_by_test_id("assist-load-model").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )
            expect(page.get_by_test_id("assist-load-model")).to_have_text(
                "Re-download " + ("P10" if profile == "p10" else "BPSD") + " (FP32)"
            )
            expect(page.get_by_test_id("assist-message")).to_contain_text(
                "missing from local storage"
            )

            page.evaluate("""async()=>{
                const assist=document.querySelector('nextmedtator-assist').assist;
                const {ModelStorageError}=await import('/app/nextmedtator/model-store.mjs');
                assist.unavailableInstalledModels.clear();
                assist.modelStore.read=async()=>{throw new ModelStorageError(new DOMException('Storage unavailable','UnknownError'));};
                assist.render();
            }""")
            page.get_by_test_id("assist-load-model").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )
            expect(page.get_by_test_id("assist-load-model")).to_have_text(
                "Load Installed " + ("P10" if profile == "p10" else "BPSD")
            )
            expect(page.get_by_test_id("assist-message")).to_contain_text(
                "Browser could not save the model (UnknownError)"
            )

            # A verified read restores the cached action and clears the
            # session-only unavailable marker without running inference.
            page.evaluate("""async()=>{
                const assist=document.querySelector('nextmedtator-assist').assist;
                const row=assist.installedModels[0];
                assist.modelStore.read=async()=>({manifest:row.manifest,manifestHash:row.manifestHash,files:new Map()});
            }""")
            page.get_by_test_id("assist-load-model").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy && !!document.querySelector('nextmedtator-assist').assist.model"
            )
            page.evaluate("document.querySelector('nextmedtator-assist').assist.unloadModel()")
            expect(page.get_by_test_id("assist-load-model")).to_have_text(
                "Load Installed " + ("P10" if profile == "p10" else "BPSD")
            )

            # A valid in-memory package can replace a corrupt installation
            # through the explicit offline-install action. Clearing the
            # session marker is valid only after modelStore.install succeeds.
            page.evaluate("""()=>{
                const assist=document.querySelector('nextmedtator-assist').assist;
                const row=assist.installedModels[0];
                const candidate={manifest:row.manifest,manifestHash:row.manifestHash,files:new Map()};
                assist.unavailableInstalledModels.set(row.manifestHash,'corrupt');
                assist.modelStore.install=async()=>candidate;
                assist.modelStore.listExisting=async()=>[row];
                assist.adoptModel(candidate);
                assist.render();
            }""")
            options=page.get_by_test_id("assist-download-options")
            if options.get_attribute("open") is None:
                options.locator(":scope > summary").click()
            page.get_by_role("button", name="Install for Offline Use").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )
            page.get_by_test_id("assist-unload-model").click()
            expect(page.get_by_test_id("assist-load-model")).to_have_text(
                "Load Installed " + ("P10" if profile == "p10" else "BPSD")
            )
            assert page.evaluate(
                "JSON.stringify(app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags)"
            ) == page.evaluate("window.__repairTagsBefore")

            # Listing metadata can retain valid source lineage while its
            # variant array is missing or malformed. It must remain repairable
            # through the exact selected catalog source and precision.
            page.evaluate(
                """profile=>{
                    const assist=document.querySelector('nextmedtator-assist').assist;
                    const source=assist.catalog.entries.find(item=>
                        item.manifest.id===(profile==='p10'?'clinical-evidence-p10-base-r2':'bpsd-gliner25-base-r2'));
                    const manifest=structuredClone(source.manifest);
                    if(profile==='p10')delete manifest.variants;
                    else manifest.variants=[];
                    assist.installedModels=[{manifest,manifestHash:'b'.repeat(64),bytes:0}];
                    assist.unavailableInstalledModels.clear();
                    window.__malformedVariantReads=0;
                    assist.modelStore.read=async()=>{
                        window.__malformedVariantReads++;
                        throw new Error('Malformed metadata must route directly to verified repair');
                    };
                    assist.render();
                }""",
                profile,
            )
            repair_label = "Repair " + ("P10" if profile == "p10" else "BPSD") + " (FP32)"
            expect(page.get_by_test_id("assist-load-model")).to_have_text(repair_label)
            page.get_by_test_id("assist-load-model").click()
            malformed_dialog = page.get_by_role("dialog", name="Verify Model Download")
            expect(malformed_dialog).to_be_visible()
            assert page.evaluate("window.__malformedVariantReads") == 0
            assert page.evaluate(
                "document.querySelector('nextmedtator-assist').assist.modelSelection.id"
            ) == ("clinical-p10" if profile == "p10" else "bpsd-base")
            assert page.evaluate(
                "JSON.stringify(app_hotpot.vpp.$data.anns[app_hotpot.vpp.$data.ann_idx].tags)"
            ) == page.evaluate("window.__repairTagsBefore")
            malformed_dialog.get_by_role("button", name="Cancel Download").click()
            page.wait_for_function(
                "() => !document.querySelector('nextmedtator-assist').assist.busy"
            )
            assert page.evaluate("window.__malformedVariantReads") == 0

        assert not errors, errors
        assert any("/verify?" in url for url in requests), requests
        assert not any("/grant" in url or "/nextmedtator-models/" in url for url in requests), requests
        browser.close()


if __name__ == "__main__":
    run()
