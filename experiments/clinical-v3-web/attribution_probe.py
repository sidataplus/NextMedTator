"""Predicted-label margin IG with the complete clinical release prompt.

Bounded synthetic probe, not a clinical cue qualification or browser timing.
"""

import argparse, json, sys, time
from pathlib import Path
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--base", type=Path, required=True)
    p.add_argument("--size", choices=["small", "base"], default="base")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--limit", type=int, default=6)
    p.add_argument("--case-ids", default="assertion-01,temporality-01,experiencer-01")
    p.add_argument("--max-points", type=int, choices=[64, 128, 256], default=64)
    a = p.parse_args()
    sys.path.insert(0, str(a.release.absolute()))
    import usage, torch
    from cue_cases import cases

    loaded = usage.load_model(
        a.size, package_dir=a.release, adapter_dir=a.release, base_dir=a.base
    )
    model = loaded.model.merge_and_unload(safe_merge=True).eval()
    torch.set_num_threads(4)
    for param in model.parameters():
        param.requires_grad_(False)
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)
    from gliner2.training.trainer import ExtractorCollator
    from gliner2.processing.word_splitter import WhitespaceTokenSplitter

    collate = ExtractorCollator(
        model.processor, is_training=False, architecture="boundary"
    )
    schemas, _ = model._build_schema_dicts_and_metadata([loaded.schema])
    selected = a.case_ids.split(",")[: a.limit]
    runs = []
    for c in [v for v in cases() if v["id"] in selected]:
        batch = collate([(c["text"], schemas[0])])
        words = list(WhitespaceTokenSplitter()(c["text"]))
        anchor = c["anchor"]
        aw = [
            i
            for i, (_, s, e) in enumerate(words)
            if s < anchor["end"] and e > anchor["start"]
        ]
        axis = {"temporality": "time frame"}.get(c["group"], c["group"])
        core = model._encode_core(batch)
        slots = [
            i
            for i, v in enumerate(core["ext_specs"][0])
            if v["field_name"].startswith(axis + ": ")
        ]
        labels = [
            core["ext_specs"][0][i]["field_name"].split(": ", 1)[1] for i in slots
        ]
        qi = batch.query_marker_indices[:, slots]
        ti = batch.text_word_indices
        tm = batch.text_word_mask.bool()
        attention = batch.attention_mask
        actual = model.encoder.get_input_embeddings()(batch.input_ids).detach()
        spans = torch.tensor([[[[aw[0], aw[-1] + 1]]]]).expand(1, len(slots), 1, 2)

        def logits(e):
            n = e.shape[0]
            h = model.encoder(
                inputs_embeds=e, attention_mask=attention.expand(n, -1)
            ).last_hidden_state
            d = h.shape[-1]
            text = h.gather(
                1, ti.expand(n, -1).unsqueeze(-1).expand(-1, -1, d)
            ) * tm.expand(n, -1).unsqueeze(-1)
            queries = h.gather(1, qi.expand(n, -1).unsqueeze(-1).expand(-1, -1, d))
            return (
                model.boundary_head.score_explicit_spans(
                    text,
                    tm.expand(n, -1),
                    queries,
                    torch.ones(n, len(slots), dtype=torch.bool),
                    spans.expand(n, -1, -1, -1),
                )[:, :, 0]
                / model.boundary_settings.pair_temperature
            )

        with torch.no_grad():
            real = logits(actual)[0]
        order = real.argsort(descending=True)
        target, contrast = int(order[0]), int(order[1])
        context = []
        for i in range(len(words)):
            if aw[0] <= i <= aw[-1]:
                continue
            start = int(ti[0, i])
            end = int(ti[0, i + 1]) if i + 1 < len(words) else actual.shape[1] - 1
            context.extend(range(start, end))
        for baseline in ["PAD", "MASK"]:
            token = getattr(model.processor.tokenizer, baseline.lower() + "_token_id")
            base = actual.clone()
            base[:, context] = model.encoder.get_input_embeddings().weight[token]
            difference = actual - base
            with torch.no_grad():
                scores = logits(torch.cat([base, actual]))
                gap = float(
                    (scores[1, target] - scores[1, contrast])
                    - (scores[0, target] - scores[0, contrast])
                )
            previous = None
            for points in [n for n in [16, 32, 64, 128, 256] if n <= a.max_points]:
                nodes, weights = np.polynomial.legendre.leggauss(points)
                nodes = (nodes + 1) / 2
                weights = weights / 2
                integral = torch.zeros_like(actual, dtype=torch.float64)
                start = time.perf_counter()
                for offset in range(0, points, 2):
                    n = torch.tensor(nodes[offset : offset + 2], dtype=torch.float32)[
                        :, None, None
                    ]
                    e = (base + n * difference).requires_grad_()
                    score = logits(e)
                    grad = torch.autograd.grad(
                        (score[:, target] - score[:, contrast]).sum(), e
                    )[0]
                    integral += (
                        grad.double()
                        * torch.tensor(
                            weights[offset : offset + 2], dtype=torch.float64
                        )[:, None, None]
                    ).sum(0, keepdim=True)
                attrs = (integral * difference.double()).sum(-1)[0]
                word_scores = []
                for i, (text, s, endchar) in enumerate(words):
                    start_token = int(ti[0, i])
                    end_token = (
                        int(ti[0, i + 1]) if i + 1 < len(words) else actual.shape[1] - 1
                    )
                    word_scores.append(
                        {
                            "text": text,
                            "start": s,
                            "end": endchar,
                            "anchor": aw[0] <= i <= aw[-1],
                            "score": float(attrs[start_token:end_token].sum()),
                        }
                    )
                values = np.array([r["score"] for r in word_scores if not r["anchor"]])
                ranking = sorted(
                    [r for r in word_scores if not r["anchor"] and r["score"] > 0],
                    key=lambda r: -r["score"],
                )
                top = ranking[:3]
                delta = float(attrs.sum()) - gap
                complete = abs(delta) < 0.05 and abs(delta) / max(abs(gap), 1e-6) < 0.05
                stable = None
                if previous:
                    old, oldvalues = previous
                    cos = (
                        float(
                            values
                            @ oldvalues
                            / (np.linalg.norm(values) * np.linalg.norm(oldvalues))
                        )
                        if np.linalg.norm(values) * np.linalg.norm(oldvalues) > 0
                        else None
                    )
                    spanset = lambda rows: {(r["start"], r["end"]) for r in rows}
                    oldset, newset = spanset(old), spanset(top)
                    jaccard = (
                        len(oldset & newset) / len(oldset | newset)
                        if oldset | newset
                        else 1
                    )
                    same = (
                        (old[0]["start"], old[0]["end"])
                        == (top[0]["start"], top[0]["end"])
                        if old and top
                        else not old and not top
                    )
                    stable = {
                        "passes": same
                        and jaccard >= 0.5
                        and cos is not None
                        and cos >= 0.95,
                        "signedCosine": cos,
                        "top3Jaccard": jaccard,
                        "top1Same": same,
                    }
                row = {
                    "id": c["id"],
                    "text": c["text"],
                    "baseline": baseline,
                    "points": points,
                    "expected": c["expectedLabel"],
                    "predicted": labels[target],
                    "contrast": labels[contrast],
                    "complete": complete,
                    "stability": stable,
                    "delta": delta,
                    "marginGap": gap,
                    "top": top,
                    "top1CueHit": bool(
                        top
                        and any(
                            top[0]["start"] < cue["end"]
                            and top[0]["end"] > cue["start"]
                            for cue in c["cueSpans"]
                        )
                    ),
                    "tokens": word_scores,
                    "elapsedMs": (time.perf_counter() - start) * 1000,
                }
                runs.append(row)
                print(
                    json.dumps(
                        {
                            k: row[k]
                            for k in [
                                "id",
                                "baseline",
                                "points",
                                "complete",
                                "top1CueHit",
                                "elapsedMs",
                            ]
                        }
                    ),
                    flush=True,
                )
                previous = (top, values)
                a.out.write_text(
                    json.dumps(
                        {
                            "model": a.size,
                            "scope": "Native PyTorch predicted-label margin IG, full release schema; partial checkpoint until the process completes",
                            "runs": runs,
                        },
                        indent=2,
                    )
                    + "\n"
                )
                if points >= 64 and complete and stable["passes"]:
                    break
    result = {
        "model": a.size,
        "scope": "Predeclared synthetic examples; predicted-label minus runner-up targets, full 18-query prompt; native PyTorch timings only; no clinical validation",
        "runs": runs,
    }
    a.out.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
