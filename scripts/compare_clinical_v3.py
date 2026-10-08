"""Compare pinned clinical adapters with their verified release helper.

Synthetic forced-anchor diagnostics; no clinical or held-out accuracy claim.
Run each size in a fresh process because the helper locks runtime import paths.
"""

import argparse, importlib.util, json, sys, time
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--base", type=Path, required=True)
    p.add_argument("--size", choices=["small", "base"], required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    sys.path.insert(0, str(a.release.absolute()))
    import usage, torch

    loaded = usage.load_model(
        a.size, package_dir=a.release, adapter_dir=a.release, base_dir=a.base
    )
    from gliner2.training.trainer import ExtractorCollator
    from gliner2.processing.word_splitter import WhitespaceTokenSplitter

    spec = importlib.util.spec_from_file_location(
        "cue_cases",
        Path(__file__).resolve().parents[1]
        / "experiments/clinical-v3-web/cue_cases.py",
    )
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    cases = m.cases()
    collate = ExtractorCollator(
        loaded.model.processor, is_training=False, architecture="boundary"
    )
    schemas, _ = loaded.model._build_schema_dicts_and_metadata([loaded.schema])
    rows = []
    for c in cases:
        start = time.perf_counter()
        prediction = loaded.predict(c["text"])
        batch = collate([(c["text"], schemas[0])])
        with torch.no_grad():
            core = loaded.model._encode_core(batch)
            words = list(WhitespaceTokenSplitter()(c["text"]))
            anchor = c["anchor"]
            indices = [
                i
                for i, (_, s, e) in enumerate(words)
                if s < anchor["end"] and e > anchor["start"]
            ]
            assert (
                words[indices[0]][1] == anchor["start"]
                and words[indices[-1]][2] == anchor["end"]
            )
            spans = torch.tensor([[[[indices[0], indices[-1] + 1]]]]).expand(
                1, core["query_states"].shape[1], 1, 2
            )
            scores = (
                loaded.model.boundary_head.score_explicit_spans(
                    core["text_states"],
                    core["text_mask"].bool(),
                    core["query_states"],
                    core["query_mask"].bool(),
                    spans,
                )[0, :, 0]
                / loaded.model.boundary_settings.pair_temperature
            )
        axis = {"temporality": "time frame"}.get(c["group"], c["group"])
        field = {"temporality": "time_frame"}.get(c["group"], c["group"])
        slots = [
            i
            for i, s in enumerate(core["ext_specs"][0])
            if s["field_name"].startswith(axis + ": ")
        ]
        labels = [
            core["ext_specs"][0][i]["field_name"].split(": ", 1)[1] for i in slots
        ]
        assert len(slots) == len(loaded.value_maps[axis]), (axis, core["ext_specs"][0])
        values = scores[slots]
        forced = labels[int(values.argmax())]
        matches = [
            r
            for r in prediction["spans"]
            if (r["start"], r["end"]) == (anchor["start"], anchor["end"])
        ]
        row = {
            **c,
            "axis": axis,
            "forcedPrediction": forced,
            "forcedCorrect": forced == c["expectedLabel"],
            "logits": values.tolist(),
            "axisLabels": labels,
            "exactAnchorFound": bool(matches),
            "exactAnchorAndAxisCorrect": any(
                r["attributes"][field]["label"] == c["expectedLabel"] for r in matches
            ),
            "returnedSpans": prediction["spans"],
            "elapsedMs": (time.perf_counter() - start) * 1000,
        }
        rows.append(row)
        print(
            json.dumps(
                {
                    "size": a.size,
                    "id": c["id"],
                    "forced": forced,
                    "expected": c["expectedLabel"],
                    "anchorFound": bool(matches),
                }
            ),
            flush=True,
        )

    def stats(r):
        return {
            "n": len(r),
            "forcedCorrect": sum(x["forcedCorrect"] for x in r),
            "exactAnchorFound": sum(x["exactAnchorFound"] for x in r),
            "exactAnchorAndAxisCorrect": sum(x["exactAnchorAndAxisCorrect"] for x in r),
        }

    result = {
        "model": a.size,
        "threshold": loaded.threshold,
        "adapterRevision": (a.release / "revision.txt").read_text().strip(),
        "baseRevision": loaded.base_revision,
        "runtime": loaded.runtime_versions,
        "runtimeFingerprint": usage.RUNTIME_FINGERPRINT,
        "scope": "96 existing synthetic cue cases; full 18-query official schema; exact anchor coverage accepts any returned core type, and is not typed entity recall. Legacy cue labels include ambiguous resolved/recent cases. Not clinical validation.",
        "summary": stats(rows),
        "groups": {
            g: stats([r for r in rows if r["group"] == g])
            for g in ["assertion", "temporality", "experiencer"]
        },
        "rows": rows,
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"]), flush=True)


if __name__ == "__main__":
    main()
