"""Real installed-Chrome WebGPU checks for public P10/BPSD packages.

Run with ``python tests/browser/test_mac_gpu_conformance.py``. The test uses a
fresh, temporary Chrome context (never a user's browser profile), never downloads
models, and writes a report after each model so a later failure does not erase
earlier evidence.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_support import chromium_path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "temp/mac-gpu"
REPORT_PATHS = {
    "fp16": OUTPUT_DIR / "chrome-fp16-conformance.json",
    "fp32": OUTPUT_DIR / "chrome-fp32-conformance.json",
}
CATALOG_PATH = ROOT / "deployment/production-model-catalog.json"
DEFAULT_URL = "http://127.0.0.1:4299/"
PACKAGE_IDS = {
    "p10": {"fp16": "p10-fp16-r2", "fp32": "clinical-evidence-p10-base-r2"},
    "bpsd": {"fp16": "bpsd-fp16-r2", "fp32": "bpsd-gliner25-base-r2"},
}
PRACTICE_COUNTS = {"p10": 2, "bpsd": 5}
MANUAL_TAGS = {"p10": ("patient", "condition_occurrence"), "bpsd": ("She", "Other")}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profiles", nargs="+", choices=tuple(PACKAGE_IDS), default=["p10", "bpsd"]
    )
    parser.add_argument("--precision", choices=tuple(REPORT_PATHS), default="fp16")
    parser.add_argument(
        "--models-dir",
        default=os.environ.get("NMT_MODEL_DIR", str(OUTPUT_DIR)),
        help="Directory containing <profile>-<precision>.nmt-model.zip packages",
    )
    parser.add_argument("--url", default=os.environ.get("NMT_DEPLOYED_URL", DEFAULT_URL))
    parser.add_argument("--headed", action="store_true", help="Show the fresh Chrome window")
    return parser.parse_args()


def package_path(models_dir, profile, precision):
    path = Path(models_dir).expanduser().resolve() / f"{profile}-{precision}.nmt-model.zip"
    if path.is_file():
        return path
    # Keep the convenient temp/mac-gpu default zero-copy: link to the exact
    # packages the user approved and had independently verified in Downloads.
    if Path(models_dir).expanduser().resolve() == OUTPUT_DIR.resolve():
        source = Path("/Users/na399/Downloads") / path.name
        if source.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                path.symlink_to(source)
            if path.is_file():
                return path
    raise FileNotFoundError(f"Verified local package is missing: {path}")


def write_report(report, report_path):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    temporary = report_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(report_path)


def artifact_prefix(profile, precision):
    return profile if precision == "fp16" else f"{profile}-{precision}"


def local_network_audit(requests, base_url):
    base = urlsplit(base_url)
    external = []
    model_requests = []
    for method, url in requests:
        parsed = urlsplit(url)
        if (parsed.scheme, parsed.netloc) != (base.scheme, base.netloc):
            external.append({"method": method, "origin": f"{parsed.scheme}://{parsed.netloc}"})
        if "nmt-models" in parsed.netloc or "/models/catalog" in parsed.path:
            model_requests.append({"method": method, "path": parsed.path})
    return {
        "requestCount": len(requests),
        "externalRequests": external,
        "catalogOrModelRequests": model_requests,
        "nonGetMethods": sorted({method for method, _ in requests if method != "GET"}),
    }


def chrome_executable():
    configured = chromium_path()
    if configured and Path(configured).is_file():
        return configured
    installed_chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if installed_chrome.is_file():
        return str(installed_chrome)
    raise FileNotFoundError("Installed Google Chrome was not found; set CHROMIUM_PATH explicitly")


def adapter_details(page):
    return page.evaluate(
        """async()=>{
            if(!navigator.gpu)return {supported:false};
            try{
                const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
                if(!adapter)return {supported:true,adapter:false};
                let info={};
                try{
                    const value=adapter.info??await adapter.requestAdapterInfo?.();
                    if(value)info={vendor:value.vendor??null,architecture:value.architecture??null,
                        device:value.device??null,description:value.description??null};
                }catch(error){info={error:String(error)};}
                const limits={};
                for(const key of ['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupSizeX',
                    'maxComputeWorkgroupSizeY','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupsPerDimension'])
                    if(Number.isFinite(adapter.limits?.[key]))limits[key]=adapter.limits[key];
                return {supported:true,adapter:true,isFallbackAdapter:adapter.isFallbackAdapter??null,
                    info,features:[...adapter.features].sort(),limits};
            }catch(error){return {supported:true,adapter:false,error:String(error)};}
        }"""
    )


def state_snapshot(page):
    return page.evaluate(
        """()=>{
            const a=document.querySelector('nextmedtator-assist')?.assist;
            if(!a)return {assist:false};
            const run=a.current()?.run;
            return {assist:true,error:a.error,message:a.message,busy:a.busy,
                model:a.model?{id:a.model.manifest.id,manifestHash:a.model.manifestHash,
                    variants:a.model.manifest.variants.map(v=>({id:v.id,precision:v.precision,backend:v.backend}))}:null,
                deviceProfile:a.deviceProfile??null,gpuCheck:a.gpuCheck??null,
                workerActive:!!a.modelRunner.worker,run:run??null,
                nativeTags:window.app_hotpot?.vpp?.$data?.anns?.[window.app_hotpot?.vpp?.$data?.ann_idx]?.tags?.map(t=>({...t}))??[]};
        }"""
    )


def run_profile(playwright, browser, profile, precision, models_dir, url, entry, report_path):
    expected_hash = entry["revision"]
    package_id = PACKAGE_IDS[profile][precision]
    variant = entry["manifest"]["variants"][0]
    expected_variant = {
        "id": variant["id"],
        "precision": variant["precision"],
        "backend": variant["backend"],
    }
    fixture_count = len(variant["fixtures"])
    prefix = artifact_prefix(profile, precision)
    result = {
        "profile": profile,
        "precision": precision,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "status": "running",
        "timingsSeconds": {},
        "screenshots": {},
    }
    context = None
    page = None
    requests = []
    page_errors = []
    started = time.perf_counter()
    try:
        package = package_path(models_dir, profile, precision)
        result["package"] = {
            "path": str(package),
            "bytes": package.stat().st_size,
            "expectedPackageId": package_id,
            "expectedManifestHash": expected_hash,
            "expectedVariant": expected_variant,
            "expectedFixtureCount": fixture_count,
        }
        context = browser.new_context(
            viewport={"width": 1440, "height": 1050},
            accept_downloads=True,
            service_workers="block",
        )
        page = context.new_page()
        page.set_default_timeout(600_000)
        expect.set_options(timeout=600_000)
        page.on("request", lambda request: requests.append((request.method, request.url)))
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())

        phase = time.perf_counter()
        page.goto(url, wait_until="domcontentloaded")
        expect(page.locator("#start-screen")).to_be_hidden()
        page.get_by_test_id(f"assist-practice-{profile}").click()
        page.wait_for_function(
            "profile => {const a=document.querySelector('nextmedtator-assist').assist;"
            "return !a.busy && a.modelSelection.id===profile;}",
            arg="clinical-p10" if profile == "p10" else "bpsd-base",
        )
        result["timingsSeconds"]["pageAndPracticeReady"] = round(time.perf_counter() - phase, 3)
        result["adapter"] = adapter_details(page)
        result["userAgent"] = page.evaluate("navigator.userAgent")
        result["crossOriginIsolated"] = page.evaluate("crossOriginIsolated")
        assert result["crossOriginIsolated"], "WebGPU worker requires cross-origin isolation"

        phase = time.perf_counter()
        page.get_by_test_id("assist-local-packages").locator(":scope > summary").click()
        page.get_by_label("Import model package into the annotation assistance panel").set_input_files(
            str(package)
        )
        page.wait_for_function(
            "()=>{const a=document.querySelector('nextmedtator-assist').assist;return !a.busy&&!!a.model;}"
        )
        imported = state_snapshot(page)
        result["timingsSeconds"]["packageImport"] = round(time.perf_counter() - phase, 3)
        result["model"] = imported["model"]
        assert imported["model"]["id"] == package_id, imported["model"]
        assert imported["model"]["manifestHash"] == expected_hash, imported["model"]
        assert imported["model"]["variants"] == [expected_variant], imported["model"]

        page.get_by_test_id("assist-download-options").locator(":scope > summary").click()
        phase = time.perf_counter()
        page.get_by_test_id("assist-check-gpu").click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        diagnostic = state_snapshot(page)
        result["timingsSeconds"]["mandatoryConformance"] = round(time.perf_counter() - phase, 3)
        result["diagnostic"] = diagnostic["gpuCheck"]
        result["diagnosticState"] = {
            "error": diagnostic["error"],
            "message": diagnostic["message"],
            "workerReleased": not diagnostic["workerActive"],
            "noteInferenceStarted": diagnostic["run"] is not None,
        }
        page.screenshot(path=str(OUTPUT_DIR / f"{prefix}-diagnostic.png"), full_page=True)
        result["screenshots"]["diagnostic"] = str(OUTPUT_DIR / f"{prefix}-diagnostic.png")

        # Capture full mandatory results before checking them. This makes
        # conformance failures inspectable and allows the other model to run.
        check = result["diagnostic"]
        assert check, "WebGPU returned no public-fixture conformance summary"
        assert check["pass"] is True, check
        assert check["backend"] == "webgpu" and check["precision"] == precision, check
        assert check["manifestHash"] == expected_hash, check
        assert check["variantId"] == expected_variant["id"], check
        assert len(check["fixtures"]) == fixture_count and all(row["pass"] for row in check["fixtures"]), check
        assert not diagnostic["workerActive"] and diagnostic["run"] is None, diagnostic

        # The selection widget intentionally exposes automatic and WASM modes;
        # set the same internal preference the runner consumes to make this
        # qualification run strictly WebGPU with no recovery fallback.
        page.evaluate(
            "()=>{const a=document.querySelector('nextmedtator-assist').assist;"
            "a.executionPreference='webgpu';a.render();}"
        )
        phase = time.perf_counter()
        page.get_by_test_id("assist-analyze").click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        inference = state_snapshot(page)
        result["timingsSeconds"]["practiceInference"] = round(time.perf_counter() - phase, 3)
        run = inference["run"]
        runtime = run.get("runtime") if run else None
        result["practice"] = {
            "status": run.get("status") if run else None,
            "backend": runtime.get("backend") if runtime else None,
            "precision": runtime.get("precision") if runtime else None,
            "producer": run.get("producer") if run else None,
            "runtime": runtime,
            "records": run.get("records") if run else None,
        }
        assert not inference["error"], inference["message"]
        assert run and run["status"] == "complete", run
        assert runtime["backend"] == "webgpu" and runtime["precision"] == precision, run
        assert "fallbackReason" not in runtime and "fallbackFrom" not in runtime, run
        assert run["producer"]["manifestHash"] == expected_hash, run["producer"]
        assert runtime["variantId"] == expected_variant["id"], runtime
        assert len(run["records"]) == PRACTICE_COUNTS[profile], run["records"]
        assert not inference["workerActive"], "Inference worker was not released"
        page.screenshot(path=str(OUTPUT_DIR / f"{prefix}-practice-review.png"), full_page=True)
        result["screenshots"]["practiceReview"] = str(
            OUTPUT_DIR / f"{prefix}-practice-review.png"
        )

        # Seed a genuine native manual annotation after inference, then accept a
        # model proposal through the user-facing review controls. Compare the
        # exact existing tag object after the write to catch accidental loss.
        token, family = MANUAL_TAGS[profile]
        manual = page.evaluate(
            """({token,family})=>{
                const a=document.querySelector('nextmedtator-assist').assist;
                const view=window.app_hotpot.vpp.$data,ann=view.anns[view.ann_idx];
                const start=ann.text.indexOf(token);
                if(start<0||!view.dtd.tag_dict[family])throw new Error('Manual-tag fixture is unavailable');
                const id=a.writeAnnotation({anchor:[{start,end:start+token.length,text:token}]},family,{});
                const tag=ann.tags.find(row=>row.id===id);
                return {id,family:tag.tag,serialized:JSON.stringify(tag),tag};
            }""",
            {"token": token, "family": family},
        )
        manual_anchors = [
            {"start": int(start), "end": int(end)}
            for raw_span in manual["tag"]["spans"].split(",")
            for start, end in [raw_span.split("~", 1)]
        ]
        result["manualTag"] = {
            "id": manual["id"],
            "family": manual["family"],
            "span": [manual["tag"]["spans"]],
            "anchors": manual_anchors,
            "preservedAfterAssistedWrite": False,
        }
        page.get_by_test_id("assist-suggestion").first.get_by_test_id("assist-accept").click()
        page.get_by_test_id("assist-add").click()
        page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
        write_state = page.evaluate(
            """({id,serialized})=>{
                const tags=window.app_hotpot.vpp.$data.anns[window.app_hotpot.vpp.$data.ann_idx].tags;
                const tag=tags.find(row=>row.id===id);
                return {tagCount:tags.length,manualTag:tag??null,
                    exactObjectPreserved:!!tag&&JSON.stringify(tag)===serialized};
            }""",
            {"id": manual["id"], "serialized": manual["serialized"]},
        )
        result["manualTag"]["preservedAfterAssistedWrite"] = write_state["exactObjectPreserved"]
        result["reviewWrite"] = {
            "nativeTagCount": write_state["tagCount"],
            "acceptedSuggestion": True,
        }
        assert write_state["tagCount"] == 2 and write_state["exactObjectPreserved"], write_state

        phase = time.perf_counter()
        with page.expect_download() as download:
            page.get_by_role("button", name="Export evidence project", exact=True).click()
        archive = OUTPUT_DIR / f"{prefix}-accepted-evidence.nmt.zip"
        download.value.save_as(str(archive))
        result["export"] = {"path": str(archive), "bytes": archive.stat().st_size}
        more_tools = page.get_by_test_id("assist-more")
        if more_tools.get_attribute("open") is None:
            more_tools.locator(":scope > summary").click()
        page.get_by_role("button", name="Open evidence project", exact=True).click()
        page.get_by_label("Open project/files", exact=True).set_input_files(str(archive))
        expect(page.get_by_test_id("human-record")).to_have_count(2)
        reopened = page.evaluate(
            """()=>{
                const p=document.querySelector('nextmedtator-workspace').workspace.project.current;
                const run=p.runs.at(-1);
                return {recordCount:p.draft.records.length,
                    records:p.draft.records.map(r=>({id:r.id,family:r.family,
                        anchors:(r.anchor??[]).map(a=>({start:a.start,end:a.end})),
                        legacyTagId:r.origin?.legacyTagId??null,
                        originKind:r.origin?.kind??null})),
                    runCount:p.runs.length,run:run?{id:run.id,status:run.status,
                        producer:run.producer,runtime:run.runtime,recordCount:run.records.length}:null};
            }"""
        )
        result["timingsSeconds"]["exportAndReimport"] = round(time.perf_counter() - phase, 3)
        result["reimport"] = reopened
        assert reopened["recordCount"] == 2 and reopened["runCount"] == 1, reopened
        assert any(
            (
                (row["originKind"] == "imported" and row["id"] == manual["id"])
                or (row["originKind"] == "human-review" and row["legacyTagId"] == manual["id"])
            )
            and row["family"] == family
            and row["anchors"] == manual_anchors
            for row in reopened["records"]
        ), reopened
        assert reopened["run"]["producer"]["manifestHash"] == expected_hash, reopened
        assert reopened["run"]["runtime"] == run["runtime"], reopened
        assert reopened["run"]["recordCount"] == PRACTICE_COUNTS[profile], reopened
        page.screenshot(path=str(OUTPUT_DIR / f"{prefix}-reimported.png"), full_page=True)
        result["screenshots"]["reimported"] = str(OUTPUT_DIR / f"{prefix}-reimported.png")

        result["networkAudit"] = local_network_audit(requests, url)
        result["pageErrors"] = page_errors
        assert not result["networkAudit"]["externalRequests"], result["networkAudit"]
        assert not result["networkAudit"]["catalogOrModelRequests"], result["networkAudit"]
        assert not result["networkAudit"]["nonGetMethods"], result["networkAudit"]
        assert not page_errors, page_errors
        result["status"] = "passed"
    except Exception as error:  # retain partial diagnostic evidence and proceed to the next model
        result["status"] = "failed"
        result["error"] = f"{type(error).__name__}: {error}"
        if page is not None:
            try:
                partial = state_snapshot(page)
                result.setdefault("diagnostic", partial.get("gpuCheck"))
                result.setdefault("model", partial.get("model"))
                result.setdefault("pageErrors", page_errors)
            except Exception as snapshot_error:
                result["snapshotError"] = f"{type(snapshot_error).__name__}: {snapshot_error}"
    finally:
        result["wallSeconds"] = round(time.perf_counter() - started, 3)
        if requests:
            result["networkAudit"] = local_network_audit(requests, url)
        result["finishedAt"] = datetime.now(timezone.utc).isoformat()
        if context is not None:
            try:
                context.close()
            except Exception as close_error:
                result["contextCloseError"] = f"{type(close_error).__name__}: {close_error}"
    return result


def main():
    args = parse_args()
    report_path = REPORT_PATHS[args.precision]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entries = {
        entry["manifest"]["id"]: entry
        for entry in catalog["entries"]
        if entry["manifest"]["id"] in {
            PACKAGE_IDS[profile][args.precision] for profile in args.profiles
        }
    }
    initial = {
        "format": "nextmedtator-mac-gpu-conformance-v1",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "url": args.url,
        "chromeExecutable": None,
        "chromeVersion": None,
        "headless": not args.headed,
        "precision": args.precision,
        "modelsDir": str(Path(args.models_dir).expanduser().resolve()),
        "profiles": {},
    }
    for profile in args.profiles:
        initial["profiles"][profile] = {"profile": profile, "status": "pending"}
    write_report(initial, report_path)
    try:
        executable = chrome_executable()
        initial["chromeExecutable"] = executable
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=executable,
                headless=not args.headed,
                args=["--enable-unsafe-webgpu", "--use-angle=metal"],
            )
            initial["chromeVersion"] = browser.version
            write_report(initial, report_path)
            for profile in args.profiles:
                entry = entries[PACKAGE_IDS[profile][args.precision]]
                current = run_profile(
                    playwright,
                    browser,
                    profile,
                    args.precision,
                    args.models_dir,
                    args.url,
                    entry,
                    report_path,
                )
                initial["profiles"][profile] = current
                write_report(initial, report_path)
                print(f"{profile}: {current['status']}", flush=True)
            browser.close()
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
        initial["launchOrHarnessError"] = failure
        for profile in args.profiles:
            if initial["profiles"][profile]["status"] == "pending":
                initial["profiles"][profile] = {
                    "profile": profile,
                    "status": "failed",
                    "error": failure,
                }
        write_report(initial, report_path)
        print(f"Chrome harness failed: {failure}; report: {report_path}", file=sys.stderr, flush=True)
    initial["finishedAt"] = datetime.now(timezone.utc).isoformat()
    write_report(initial, report_path)
    failed = [name for name, value in initial["profiles"].items() if value["status"] != "passed"]
    if failed:
        raise SystemExit(f"Mac GPU acceptance failed for {', '.join(failed)}; see {report_path}")
    print(f"All requested Mac GPU checks passed; report: {report_path}", flush=True)


if __name__ == "__main__":
    main()
