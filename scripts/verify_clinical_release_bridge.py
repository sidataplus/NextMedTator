"""Check source fixtures against independent official Torch 2.11 release smoke."""

import argparse, json, zipfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--package", type=Path, required=True)
    p.add_argument("--smoke", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    smoke = json.loads(a.smoke.read_text())
    checks = []
    with zipfile.ZipFile(a.package) as z:
        for i, row in enumerate(smoke["cases"][:5]):
            source = json.loads(z.read(f"source-case-{i}.json"))
            assert source["text"] == row["text"]
            keys = lambda rows: sorted(
                (
                    r["family"],
                    r["anchor"][0]["start"],
                    r["anchor"][0]["end"],
                    tuple(
                        sorted((k, v) for k, v in r["fields"].items() if k != "concept")
                    ),
                )
                for r in rows
            )
            expected = [
                {
                    "family": r["entity_type"],
                    "anchor": [{"start": r["start"], "end": r["end"]}],
                    "fields": {k: v["value"] for k, v in r["attributes"].items()},
                }
                for r in row["spans"]
            ]
            assert keys(source["records"]) == keys(expected), (
                row["case_id"],
                source["records"],
                expected,
            )
            checks.append(
                {"case": row["case_id"], "decisionsExact": True, "spans": len(expected)}
            )
    report = {
        "checks": checks,
        "runtime": smoke["runtime"],
        "scope": "Five identical short full-schema cases; independent official Torch 2.11 helper vs Torch 2.6 exporter source. The long smoke uses 769 tokens and differs from the bounded single-window export fixture, so it is not counted.",
    }
    a.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
