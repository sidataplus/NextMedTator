"""Local real-weight WASM latency, memory and release-reference parity."""

import argparse, asyncio, hashlib, json, statistics, threading, time, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--assets", type=Path, required=True)
    p.add_argument("--size", choices=["small", "base"], required=True)
    p.add_argument("--threads", type=int, choices=[1, 4], default=4)
    p.add_argument("--limit", type=int, default=96)
    p.add_argument("--repeats", type=int, default=1)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    if a.limit < 1 or a.repeats < 1:
        p.error("--limit and --repeats must be positive")
    graph_root = a.assets / (a.size + "-graphs")
    manifest = json.loads((graph_root / "manifest.json").read_text())
    for entry in manifest["files"]:
        contents = (graph_root / entry["path"]).read_bytes()
        if hashlib.sha256(contents).hexdigest() != entry["sha256"]:
            p.error("Package file hash differs: " + entry["path"])

    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            path = urllib.parse.urlparse(path).path
            base = (
                ROOT / "src/nextmedtator"
                if path.startswith("/app/")
                else ROOT / "node_modules/onnxruntime-web/dist"
                if path.startswith("/ort/")
                else a.assets
            )
            relative = (
                path[5:] if path.startswith(("/app/", "/ort/")) else path.lstrip("/")
            )
            if path == "/":
                return str(ROOT / "experiments/clinical-v3-web/browser_benchmark.html")
            resolved = (base / relative).resolve()
            if not resolved.is_relative_to(base.resolve()):
                return "/nonexistent"
            return str(resolved)

        def end_headers(self):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            super().end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 8956), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    async def run():
        before = {int(x.name) for x in Path("/proc").iterdir() if x.name.isdigit()}
        stop = threading.Event()
        peaks = {
            "rendererPssBytes": 0,
            "rendererVmHwmBytes": 0,
            "browserTreePssBytes": 0,
        }
        samples = 0

        def sample():
            nonlocal samples
            while not stop.is_set():
                totals = {k: 0 for k in peaks}
                for d in Path("/proc").iterdir():
                    if not d.name.isdigit() or int(d.name) in before:
                        continue
                    try:
                        cmd = (d / "cmdline").read_bytes()
                        comm = (d / "comm").read_text().strip()
                        if "chromium" not in comm:
                            continue
                        values = {
                            line.split(":", 1)[0]: int(line.split()[1]) * 1024
                            for line in (d / "smaps_rollup")
                            .read_text()
                            .splitlines()[1:]
                            if len(line.split()) > 2 and line.split()[1].isdigit()
                        }
                        totals["browserTreePssBytes"] += values.get("Pss", 0)
                        if b"--type=renderer" in cmd:
                            totals["rendererPssBytes"] += values.get("Pss", 0)
                            totals["rendererVmHwmBytes"] += next(
                                (
                                    int(line.split()[1]) * 1024
                                    for line in (d / "status").read_text().splitlines()
                                    if line.startswith("VmHWM:")
                                ),
                                0,
                            )
                    except (OSError, ValueError):
                        continue
                for k, v in totals.items():
                    peaks[k] = max(peaks[k], v)
                samples += 1
                stop.wait(0.1)

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    executable_path="/usr/bin/chromium",
                    args=["--no-sandbox", "--enable-precise-memory-info"],
                )
                page = await browser.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))

                async def record(r):
                    print(
                        json.dumps(
                            {k: r[k] for k in ["id", "repeat", "elapsedMs", "records"]}
                        ),
                        flush=True,
                    )

                await page.expose_function("recordRun", record)
                await page.goto("http://127.0.0.1:8956/")
                await page.wait_for_function("window.benchmarkReady")
                fixture = json.loads(
                    (a.assets / (a.size + "-comparison.json")).read_text()
                )
                ids = [r["id"] for r in fixture["rows"]][: a.limit]
                result = await page.evaluate(
                    "(o)=>window.runBenchmark(o)",
                    {
                        "size": a.size,
                        "threads": a.threads,
                        "caseIds": ids,
                        "repeats": a.repeats,
                    },
                )
                assert not errors, errors
                await browser.close()
            durations = sorted(r["elapsedMs"] for r in result["runs"])
            result["summary"] = {
                "n": len(durations),
                "medianMs": statistics.median(durations),
                "p90Ms": durations[int(0.9 * (len(durations) - 1))],
                "maxCoreConfidenceError": max(
                    r["maxCoreConfidenceError"] for r in result["runs"]
                ),
            }
            result["processMemoryPeak"] = peaks
            result["processMemorySamples"] = samples
            result["artifactIdentity"] = {
                "id": manifest["id"],
                "runtimeVersion": manifest["runtimeVersion"],
                "lineage": manifest["lineage"],
                "clinicalRelease": manifest["variants"][0]["clinicalRelease"],
                "graphs": [f for f in manifest["files"] if f["role"] == "graph"],
            }
            result["hostLimits"] = {
                name: Path("/sys/fs/cgroup", name).read_text().strip()
                for name in ["cpu.max", "memory.max"]
            }
            result["memoryCaveat"] = (
                "Linux PSS sampled every 100ms from this new Chromium process tree, including startup; renderer VmHWM is cumulative. WASM capacity is allocation, not live memory. Metrics overlap; do not add them."
            )
            a.out.write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result["summary"]), flush=True)
        finally:
            stop.set()
            sampler.join()
            server.shutdown()

    asyncio.run(run())


if __name__ == "__main__":
    main()
