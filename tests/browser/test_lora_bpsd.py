"""Qualify actual configured adapter Auto apply in a user-configured BPSD scope.

The four supplied synthetic notes match the archived P4/P7b captures.
The threshold and attribute protocol follow the imported model contract.
No predictions are injected, and BPSD is not a built-in preset.
"""

import json, subprocess, time, urllib.request, zipfile, sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(
    os.environ.get("NMT_LORA_PACKAGE", "/workspace/work/clinical-v3-base.nmt-model.zip")
)
assert PACKAGE.is_file(), "An actual exported model package is required"
with zipfile.ZipFile(PACKAGE) as archive:
    manifest = json.loads(archive.read("manifest.json"))
MODEL_TAG = manifest['id'].removeprefix('gliner25-clinical-evidence-')
OUT = ROOT / ('test-results/'+MODEL_TAG+'-bpsd')
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:4197/"
DEFINITION = "Extract behavioral and psychological symptoms of dementia: agitation, aggression, pacing, wandering, care resistance, yelling, repetitive questioning, hallucinations, delusions, depression, anxiety, apathy, disinhibition and disturbed sleep. Exclude falls, diagnoses, pain, medications, measurements, ADLs and care services."
fixture = json.loads((ROOT / "tests/fixtures/lora-clinical-samples.json").read_text())
ids = ["syn7_00007", "syn7_00002", "syn7_00023", "syn7_00014"]
notes = [next(n for n in fixture["notes"] if n["id"] == i) for i in ids]
server = subprocess.Popen(
    [
        sys.executable,
        "scripts/serve_static.py",
        "--directory",
        "dist",
        "--port",
        "4197",
    ],
    cwd=ROOT,
)
try:
    for _ in range(100):
        try:
            urllib.request.urlopen(URL, timeout=1).close()
            break
        except Exception:
            time.sleep(0.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/chromium", args=["--no-sandbox"]
        )
        page = browser.new_page(
            viewport={"width": 1600, "height": 2200}, accept_downloads=True
        )
        page.set_default_timeout(180000)
        expect.set_options(timeout=180000)
        errors, requests = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on(
            "request",
            lambda r: requests.append(
                {"url": r.url, "method": r.method, "body": r.post_data}
            ),
        )
        page.goto(URL)
        page.wait_for_function("window.app_hotpot?.vpp!=null")
        page.evaluate("jarvis.ssclose()")
        page.get_by_title("Load a minimal task").click()
        page.locator(".file-list-item-name", has_text="doc_01.txt.xml").wait_for()
        names = page.evaluate(
            """notes=>{app_hotpot.vpp.$data.anns=[];app_hotpot.vpp.$data.ann_idx=0;
   const names=notes.map(n=>{const a=app_hotpot.vpp.add_sample_txt_as_ann(n.text);a._filename=n.id+'.txt.xml';return a._filename;});
   app_hotpot.vpp.$data.mn4anns=1;app_hotpot.vpp.set_ann_idx(0);return names;}""",
            notes,
        )
        page.get_by_label(
            "Import model package into the annotation assistance panel"
        ).set_input_files(str(PACKAGE))
        expect(page.get_by_test_id("assist-message")).to_contain_text("package loaded")
        expect(page.get_by_test_id("assist-model-identity")).to_have_text(
            "Active model: " + manifest["id"]
        )
        page.get_by_test_id("scope-edit").click()
        page.get_by_test_id("scope-preset").select_option("events-function")
        page.get_by_test_id("scope-family-function_occurrence").uncheck()
        page.get_by_test_id("scope-name").fill("BPSD")
        page.get_by_test_id("scope-definition").fill(DEFINITION)
        page.get_by_test_id("scope-use-schema").click()
        expect(page.get_by_test_id("assist-message")).to_contain_text(
            "Clinical annotation schema loaded"
        )
        page.get_by_test_id("scope-apply").click()
        expect(page.get_by_test_id("assist-message")).to_contain_text(
            "Scope applied: BPSD"
        )
        expect(page.get_by_test_id("assist-mode")).to_have_value("auto")
        for name in names:
            page.get_by_role("checkbox", name=name, exact=True).check()
        page.get_by_test_id("assist-analyze-selected").click()
        print(
            "Running actual configured adapter: same BPSD event scope, four supplied notes, Auto apply",
            flush=True,
        )
        page.wait_for_function(
            """()=>{const a=document.querySelector('nextmedtator-assist').assist;return a.runHistory.length===4&&!a.busy;}""",
            timeout=300000,
        )
        expect(page.get_by_test_id("assist-message")).to_contain_text(
            "Auto apply finished for 4 notes"
        )
        result = page.evaluate(
            """()=>{const a=document.querySelector('nextmedtator-assist').assist;return {scope:a.scope,runs:a.runHistory,projects:[...a.projects.values()].map(p=>p.current),annotations:app_hotpot.vpp.$data.anns.map(n=>({filename:n._filename,text:n.text,tags:n.tags}))};}"""
        )
        results = []
        for i, (note, run, ann, project) in enumerate(
            zip(notes, result["runs"], result["annotations"], result["projects"])
        ):
            assert run["status"] == "complete" and run["coverage"] == [
                [0, len(note["text"])]
            ]
            assert note["text"] == ann["text"] and len(run["records"]) == len(
                ann["tags"]
            ) == len(project["draft"]["records"])
            assert run["settings"]["scope"]["profile"] == result["scope"]
            for r in run["records"]:
                assert r["family"] == "event_occurrence"
                for s in r["anchor"] + r["evidence"]:
                    assert note["text"][s["start"] : s["end"]] == s["text"]
            assert all(
                r["origin"]["reviewStatus"] == "unreviewed"
                for r in project["draft"]["records"]
            )
            page.locator(".file-list-item-name", has_text=names[i]).click()
            page.get_by_test_id("assist-suggestion-view").select_option("compact")
            count = len(run["records"])
            expect(page.get_by_test_id("assist-counts")).to_have_text(
                f"{count} machine suggestions · {count} annotation tags"
            )
            expect(page.locator(".tag-table tbody tr")).to_have_count(count)
            if count:
                page.get_by_test_id("assist-compact-suggestion").first.get_by_test_id(
                    "assist-compact-locate"
                ).click()
            # Resize and scroll real browser panes until every native and suggestion row fits.
            fit = False
            for height in [2200, 2400, 2600, 2800, 3000, 3200]:
                page.set_viewport_size({"width": 1600, "height": height})
                if count:
                    page.get_by_role("table", name="Machine suggestions").evaluate(
                        "el=>el.closest('.body').scrollTop=0"
                    )
                    page.locator("#mui_annlist").evaluate("el=>el.scrollTop=0")
                    fit = page.get_by_role(
                        "table", name="Machine suggestions"
                    ).evaluate(
                        """table=>{const pane=table.closest('.body').getBoundingClientRect(),rows=[...table.querySelectorAll('tr')];return rows[0].getBoundingClientRect().top>=pane.top-1&&rows.at(-1).getBoundingClientRect().bottom<=pane.bottom+1;}"""
                    )
                    native_fit = page.locator(".tag-table").evaluate(
                        """table=>{const pane=table.closest('#mui_annlist').getBoundingClientRect(),rows=[...table.querySelectorAll('tbody tr')],head=table.querySelector('thead').getBoundingClientRect();return rows[0].getBoundingClientRect().top>=head.bottom-1&&rows.at(-1).getBoundingClientRect().bottom<=pane.bottom-1;}"""
                    )
                    fit = fit and native_fit
                else:
                    fit = True
                if fit:
                    break
            assert fit, "Screenshot must show every actual tag"
            screenshot = f"{MODEL_TAG}-bpsd-{note['id']}-auto.png"
            expect(page.get_by_test_id("assist-model-identity")).to_be_in_viewport()
            expect(page.get_by_test_id("assist-threshold")).to_have_attribute("type", "range")
            expect(page.get_by_test_id("assist-threshold")).to_be_in_viewport()
            # Capture the rendered UI through the last row; omit unused blank space below.
            bottom = page.evaluate("""()=>Math.ceil(Math.max(document.querySelector('.tag-table tbody tr:last-child').getBoundingClientRect().bottom,document.querySelector('nextmedtator-assist').shadowRoot.querySelector('[data-testid=assist-compact-suggestion]:last-child').getBoundingClientRect().bottom))+16""") if count else height
            page.screenshot(path=str(OUT / screenshot), clip={"x":0,"y":0,"width":1600,"height":bottom})
            with page.expect_download() as d:
                page.get_by_role(
                    "button", name="Export evidence project", exact=True
                ).click()
            bundle = OUT / f"{MODEL_TAG}-bpsd-{note['id']}.nmt.zip"
            d.value.save_as(str(bundle))
            with zipfile.ZipFile(bundle) as archive:
                portable = json.loads(archive.read("project.json"))
                portable_runs = json.loads(archive.read("machine-runs/index.json"))
                assert (
                    len(portable["draft"]["records"])
                    == len(portable_runs[-1]["records"])
                    == count
                )
                assert portable["extensions"]["suggestionScope"] == result["scope"]
                assert portable_runs[-1]["producer"]["lineage"] == manifest["lineage"]
                assert all(
                    r["origin"]["kind"] == "machine-applied"
                    and r["origin"]["reviewStatus"] == "unreviewed"
                    for r in portable["draft"]["records"]
                )
                source = archive.read(portable["documents"][0]["sourceFile"]).decode()
                assert source == note["text"]
                for record in portable["draft"]["records"]:
                    for span in record["anchor"] + record.get("evidence", []):
                        assert source[span["start"] : span["end"]] == span["text"]
            results.append(
                {
                    "id": note["id"],
                    "predictions": count,
                    "nativeTags": count,
                    "allRowsVisible": True,
                    "screenshot": screenshot,
                    "viewport": page.viewport_size,
                    "anchors": [r["anchor"][0]["text"] for r in run["records"]],
                }
            )
            print(json.dumps(results[-1]), flush=True)
        page.locator(".file-list-item-name", has_text=names[0]).click()
        page.set_viewport_size({"width": 1600, "height": 2600})
        page.get_by_test_id("scope-edit").click()
        page.get_by_test_id("scope-name").scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / f"{MODEL_TAG}-bpsd-scope-editor.png"), full_page=True)
        with page.expect_download() as d:
            page.get_by_test_id("scope-export").click()
        d.value.save_as(str(OUT / f"{MODEL_TAG}-bpsd-scope.json"))
        assert not errors, errors
        assert all(
            r["url"].startswith(URL) and r["method"] == "GET" and not r["body"]
            for r in requests
        ), requests
        (OUT / f"{MODEL_TAG}-bpsd-report.json").write_text(
            json.dumps(
                {
                    "browser": browser.version,
                    "modelPackage": str(PACKAGE.name),
                    "manifestId": manifest["id"],
                    "lineage": manifest["lineage"],
                    "source": fixture["source"],
                    "customConfigurationNotPreset": True,
                    "mode": "auto",
                    "threshold": result["scope"]["threshold"],
                    "definition": DEFINITION,
                    "allRunsComplete": True,
                    "allSourceOffsetsValid": True,
                    "portableEvidenceExportsVerified": True,
                    "allAutoAppliedTagsUnreviewed": True,
                    "noNoteEgress": True,
                    "scope": result["scope"],
                    "results": results,
                    "runs": result["runs"],
                },
                indent=2,
            )
            + "\n"
        )
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
