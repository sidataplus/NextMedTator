"""Verify the selected ClinicalEvidence release before importing its runtime."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


def load_release(directory, adapter, base, model_id, revision):
    directory = Path(directory).resolve()
    if (
        hashlib.sha256((directory / "usage.py").read_bytes()).hexdigest()
        != "f63e63d649ea52f16c22a0573b11070c333374e5ac1be935e2d66fbc5f0a1986"
    ):
        raise ValueError("Clinical release helper differs from the reviewed runtime")
    spec = importlib.util.spec_from_file_location(
        "clinical_release_usage", directory / "usage.py"
    )
    helper = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = helper
    spec.loader.exec_module(helper)
    try:
        manifest = helper.verify_package(directory)
    except helper.ReleaseError as error:
        raise ValueError(str(error)) from error
    selected = [
        (name, row)
        for name, row in manifest["private_models"].items()
        if row["base_model"]["repo_id"] == model_id
        and row["base_model"]["revision"] == revision
    ]
    if len(selected) != 1:
        raise ValueError("Clinical release does not match the requested pinned base")
    size, row = selected[0]
    try:
        helper._verify_adapter_assets(Path(adapter), row)
        helper._verify_base_assets(Path(base), row)
        helper._runtime_import(directory)
    except helper.ReleaseError as error:
        raise ValueError(str(error)) from error

    registry = json.loads((directory / "schema_v3.json").read_text())
    thresholds = {
        "clinical_core": row["core_threshold"],
        "shared_axes": "one_value_softmax_no_attribute_threshold",
        "selection_sha256": row["selection_sha256"],
    }
    identity = {
        "modelSize": size,
        "runtimeFingerprint": helper.RUNTIME_FINGERPRINT,
        "registryHash": helper.REGISTRY_HASH,
        "adapterFingerprint": row["adapter_fingerprint"],
        "coreThreshold": row["core_threshold"],
    }
    return registry, thresholds, identity
