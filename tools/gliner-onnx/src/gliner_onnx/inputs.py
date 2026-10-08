"""Bounded adapter inputs and immutable base identity."""
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

MAX_ADAPTER_BYTES = 512 * 1024 * 1024
BASE_FILES = ('config.json', 'encoder_config/config.json', 'model.safetensors',
              'tokenizer.json', 'tokenizer_config.json')
PINNED_ADAPTERS = {
    'clinical-v3-small': {
        'model_key': 'small',
        'repo_id': 'na399/clinical-evidence-gliner2.5-small-lora-v3-act-sol',
        'revision': '82386c7a9776d3c14ed73d6310273a1c9d354d55',
        'base_model': 'fastino/gliner2.5-small-v1',
        'base_revision': '7132dc4561c3f94563c6147e75ffa8ef34c4964a',
        'threshold': 0.7,
    },
    'clinical-v3-base': {
        'model_key': 'base',
        'repo_id': 'na399/clinical-evidence-gliner2.5-base-lora-v3-act-sol',
        'revision': 'b5db08ccd2581690f30a448428ba7659e1469eeb',
        'base_model': 'fastino/gliner2.5-base-v1',
        'base_revision': 'ca906247640776a07753514055be9726f9080ead',
        'threshold': 0.6,
    },
}
ORIGINAL_BASES = {
    'original-small': ('fastino/gliner2.5-small-v1', '7132dc4561c3f94563c6147e75ffa8ef34c4964a'),
    'original-base': ('fastino/gliner2.5-base-v1', 'ca906247640776a07753514055be9726f9080ead'),
}

# The published adapter repositories bundle this verified GLiNER2 source tree.
# Keep the checks here so no helper/module from a Hub snapshot is executed before
# every static package asset and all 91 Python files match the release contract.
RELEASE_ASSETS = {
    'release_manifest.json': 'b5886b7943a4cd9ae34810b07f8bf85725394d7fa1550fa406f683323e9e1f22',
    'runtime_source_manifest.json': '72715f5cadf657b49cd358c49cfd06909deeb825ee68a696eb571a58dfcba6a0',
    'schema_v3.json': 'f4d6127a93171f412e81b4f06936f55bd6f54b98b58564ac3903052cd1ef345c',
    'registry_profiles.json': '2bd1413849ff094e9f8f42a271a668745ca9e9ac47dc41ed914cddb05e62e798',
    'synthetic_cases.json': '41131fbf0c06b617211d1e57ce783ffb279eb11ca599a978a590fb0612a324d2',
    'LICENSE-gliner2.txt': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
}
RELEASE_RUNTIME_FINGERPRINT = 'aec77e5692a8cf808fc0568a64b5ad882f4b8bbdedf6c3ba7b7f90b1a3d066d7'
RELEASE_REGISTRY_HASH = '80f255076cde0237c3f176b45545807bb237cbc57af1d983c6550a6d6816f547'
RELEASE_UPSTREAM_COMMIT = '55656fbfa01d3d4a77485e1a1eeeaf682990ccdf'
RELEASE_V3_ADAPTER_LICENSE = 'LicenseRef-Research-Group-Only-No-Redistribution'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def resolve_selection(selection, adapter=None, repository=None, revision=None,
                      base_model=None, base_revision=None):
    """Resolve the CLI's named model sources without downloading or importing code."""
    if selection == 'auto':
        selection = ('local-adapter' if adapter else
                     'huggingface-adapter' if repository or revision else
                     'clinical-v3-small')
    if selection in PINNED_ADAPTERS:
        if adapter or repository or revision or base_model or base_revision:
            raise ValueError('A pinned clinical selection does not accept adapter/base overrides')
        return {'selection': selection, 'kind': 'adapter', **PINNED_ADAPTERS[selection],
                'clinical_v3': True, 'adapter_license': RELEASE_V3_ADAPTER_LICENSE,
                'base_license': 'Apache-2.0'}
    if selection in ORIGINAL_BASES:
        if adapter or repository or revision:
            raise ValueError('An original GLiNER selection does not accept adapter inputs')
        expected_model, expected_revision = ORIGINAL_BASES[selection]
        if (base_model and base_model != expected_model) or (base_revision and base_revision != expected_revision):
            raise ValueError('Original GLiNER selection has a pinned base model and revision')
        return {'selection': selection, 'kind': 'base', 'base_model': expected_model,
                'base_revision': expected_revision, 'clinical_v3': False,
                'adapter_license': None, 'base_license': 'Apache-2.0'}
    if selection == 'huggingface-adapter':
        if adapter:
            raise ValueError('Use local-adapter when --adapter points to local files')
        if not repository or not revision:
            raise ValueError('Hugging Face adapters require --adapter-repository and --adapter-revision')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repository):
            raise ValueError('Adapter repository must be an owner/name Hugging Face ID')
        if not re.fullmatch(r'[a-f0-9]{40}', revision):
            raise ValueError('Adapter revision must be a full immutable 40-character commit SHA')
        return {'selection': selection, 'kind': 'adapter', 'repo_id': repository,
                'revision': revision, 'base_model': base_model,
                'base_revision': base_revision, 'clinical_v3': False,
                'adapter_license': None, 'base_license': None}
    if selection == 'local-adapter':
        if not adapter:
            raise ValueError('Local adapters require --adapter with a directory or ZIP')
        if bool(repository) != bool(revision):
            raise ValueError('Provide both --adapter-repository and --adapter-revision for local provenance')
        if repository and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repository)
                           or not re.fullmatch(r'[a-f0-9]{40}', revision)):
            raise ValueError('Local adapter provenance must use an owner/name and full commit SHA')
        return {'selection': selection, 'kind': 'adapter', 'repo_id': repository,
                'revision': revision, 'base_model': base_model,
                'base_revision': base_revision, 'clinical_v3': False,
                'adapter_license': None, 'base_license': None}
    raise ValueError(f'Unknown model selection: {selection}')


def snapshot_adapter(repo_id, revision, destination, *, include_v3_runtime=False):
    """Download only static model assets from an immutable Hub commit."""
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repo_id):
        raise ValueError('Adapter repository must be an owner/name Hugging Face ID')
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Adapter revision must be a full immutable 40-character commit SHA')
    patterns = ['adapter_config.json', 'adapter_model.safetensors']
    if include_v3_runtime:
        patterns.extend([*RELEASE_ASSETS, 'vendor/gliner2/**'])
    try:
        from huggingface_hub import snapshot_download
        return Path(snapshot_download(repo_id=repo_id, revision=revision,
                                      allow_patterns=patterns, token=None,
                                      local_dir=str(destination)))
    except Exception:
        raise ValueError('Could not download the pinned adapter snapshot') from None


def verify_v3_runtime(package_dir):
    """Verify pinned static assets and the vendored runtime before import."""
    package_dir = Path(package_dir)
    for name, expected in RELEASE_ASSETS.items():
        path = package_dir / name
        if not path.is_file() or path.is_symlink() or digest(path) != expected:
            raise ValueError(f'Pinned clinical release asset is missing or changed: {name}')
    try:
        release = json.loads((package_dir / 'release_manifest.json').read_text(encoding='utf-8'))
        runtime = json.loads((package_dir / 'runtime_source_manifest.json').read_text(encoding='utf-8'))
        schema = json.loads((package_dir / 'schema_v3.json').read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError('Pinned clinical release metadata is malformed') from None
    if not isinstance(release, dict) or release.get('schema_version') != 'clinical-evidence-dual-adapter-release/1':
        raise ValueError('Pinned clinical release manifest has an unsupported schema')
    runtime_files = runtime.get('files') if isinstance(runtime, dict) else None
    if (not isinstance(runtime_files, dict) or len(runtime_files) != 91
            or runtime.get('source_fingerprint') != RELEASE_RUNTIME_FINGERPRINT
            or runtime.get('qualified_source_fingerprint') != RELEASE_RUNTIME_FINGERPRINT
            or release.get('runtime', {}).get('upstream_commit') != RELEASE_UPSTREAM_COMMIT
            or schema.get('registry_sha256') != RELEASE_REGISTRY_HASH):
        raise ValueError('Pinned clinical runtime or schema identity changed')
    vendor = package_dir / 'vendor' / 'gliner2'
    all_paths = list(vendor.rglob('*')) if vendor.is_dir() and not vendor.is_symlink() else []
    if any(path.is_symlink() for path in all_paths):
        raise ValueError('Pinned clinical runtime contains a linked file')
    actual = {path.relative_to(vendor).as_posix() for path in all_paths if path.is_file()}
    if actual != set(runtime_files):
        raise ValueError('Pinned clinical runtime file inventory changed')
    for relative, expected in runtime_files.items():
        path = vendor / relative
        if not path.is_file() or digest(path) != expected:
            raise ValueError(f'Pinned clinical runtime source changed: {relative}')
    return release


def verify_v3_release(package_dir, model_key):
    """Verify the selected adapter metadata after validating its runtime bundle."""
    package_dir = Path(package_dir)
    release = verify_v3_runtime(package_dir)
    specs = release.get('private_models')
    spec = specs.get(model_key) if isinstance(specs, dict) else None
    if not isinstance(spec, dict):
        raise ValueError(f'Pinned clinical release has no {model_key} adapter')
    expected = next((item for item in PINNED_ADAPTERS.values() if item['model_key'] == model_key), None)
    if (not expected or spec.get('repo_id') != expected['repo_id']
            or spec.get('base_model', {}).get('repo_id') != expected['base_model']
            or spec.get('base_model', {}).get('revision') != expected['base_revision']
            or spec.get('core_threshold') != expected['threshold']):
        raise ValueError('Pinned clinical adapter metadata differs from the selected model')
    for name, expected_hash in spec.get('adapter_files', {}).items():
        path = package_dir / name
        if not path.is_file() or path.is_symlink() or digest(path) != expected_hash:
            raise ValueError(f'Pinned clinical adapter asset is missing or changed: {name}')
    return release, spec


def read_adapter(source, destination):
    """Copy only config and safetensors; never extract a caller-supplied path."""
    source, destination = Path(source), Path(destination)
    if source.is_dir():
        files = {}
        for name in ('adapter_config.json', 'adapter_model.safetensors'):
            path = source / name
            if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_ADAPTER_BYTES:
                raise ValueError(f'Missing, oversized or linked adapter member: {name}')
            files[name] = path.read_bytes()
    else:
        if source.stat().st_size > MAX_ADAPTER_BYTES:
            raise ValueError('Adapter archive exceeds 512 MiB')
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            if len(infos) > 256 or sum(i.file_size for i in infos) > MAX_ADAPTER_BYTES:
                raise ValueError('Adapter archive exceeds member/expanded-size limits')
            configs = []
            names = set()
            for info in infos:
                p = PurePosixPath(info.filename)
                if (p.is_absolute() or '..' in p.parts or '\\' in info.filename
                        or info.filename in names or stat.S_ISLNK(info.external_attr >> 16)):
                    raise ValueError('Unsafe or duplicate adapter archive path')
                names.add(info.filename)
                if p.name == 'adapter_config.json' and '__MACOSX' not in p.parts:
                    configs.append(info.filename)
            if len(configs) != 1:
                raise ValueError('Expected exactly one adapter_config.json')
            parent = PurePosixPath(configs[0]).parent
            files = {}
            for name in ('adapter_config.json', 'adapter_model.safetensors'):
                member = str(parent / name)
                if member not in names:
                    raise ValueError(f'Missing adapter member: {name}')
                files[name] = archive.read(member)
    if len(files['adapter_config.json']) > 1024 * 1024:
        raise ValueError('Adapter config exceeds 1 MiB')
    config = json.loads(files['adapter_config.json'])
    if config.get('peft_type') != 'LORA':
        raise ValueError('Only PEFT LORA adapters are supported')
    if config.get('alora_invocation_tokens') or config.get('layer_replication'):
        raise ValueError('Invocation-dependent adapters and layer replication cannot use this static GLiNER export')
    if config.get('r', 0) <= 0 or not config.get('target_modules'):
        raise ValueError('LoRA rank and target modules are required')
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (destination / name).write_bytes(data)
    identity = hashlib.sha256()
    for name in sorted(files):
        identity.update(name.encode() + b'\0' + files[name])
    return config, identity.hexdigest()


def resolve_base(config, model=None, revision=None):
    declared = config.get('base_model_name_or_path', '')
    match = re.search(r'models--([^/]+)--([^/]+)/snapshots/([0-9a-f]{40})(?:/|$)', declared)
    inferred_model = f'{match[1]}/{match[2]}' if match else declared if re.fullmatch(r'[\w.-]+/[\w.-]+', declared) else None
    inferred_revision = match[3] if match else config.get('revision')
    if model and inferred_model and model != inferred_model:
        raise ValueError('Requested base model conflicts with adapter metadata')
    if revision and inferred_revision and re.fullmatch(r'[a-f0-9]{40}', inferred_revision) and revision != inferred_revision:
        raise ValueError('Requested base revision conflicts with adapter metadata')
    model, revision = model or inferred_model, revision or inferred_revision
    if not model or not revision or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Provide --base-model and an immutable 40-character --base-revision when metadata is insufficient')
    return model, revision


def verify_base(directory, model, revision, *, expected_hashes=None):
    """Verify base bytes against pinned release hashes or immutable Hub metadata."""
    directory = Path(directory)
    hashes = {}
    if expected_hashes is not None and set(expected_hashes) != set(BASE_FILES):
        raise ValueError('Pinned base release does not contain the five runtime assets')
    if expected_hashes is None:
        from huggingface_hub import get_hf_file_metadata, hf_hub_url
    for name in BASE_FILES:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or linked base file: {name}')
        hashes[name] = digest(path)
        if expected_hashes is not None:
            if hashes[name] != expected_hashes[name]:
                raise ValueError(f'Pinned base content mismatch: {name}')
            continue
        metadata = get_hf_file_metadata(hf_hub_url(model, name, revision=revision))
        if metadata.commit_hash != revision or metadata.size != path.stat().st_size:
            raise ValueError(f'Base revision/size mismatch: {name}')
        if len(metadata.etag) == 64:
            actual = hashes[name]
        else:
            h = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
            with path.open('rb') as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    h.update(chunk)
            actual = h.hexdigest()
        if actual != metadata.etag:
            raise ValueError(f'Base content mismatch: {name}')
    cfg = json.loads((directory / 'config.json').read_text())
    if cfg.get('architecture') != 'boundary' or cfg.get('token_pooling') != 'first':
        raise ValueError('This exporter requires the GLiNER2.5 boundary architecture with first-token pooling')
    if cfg.get('boundary_head', {}).get('adaptive_threshold'):
        raise ValueError('Adaptive-count decoding requires a different browser codec')
    if cfg.get('boundary_head', {}).get('overlap_policy', 'flat') != 'flat':
        raise ValueError('This browser codec requires the flat overlap policy')
    return hashes
