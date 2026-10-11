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


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


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


def verify_base(directory, model, revision):
    """Verify local/downloaded bytes against the immutable Hub revision, including small git blobs."""
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    directory = Path(directory)
    hashes = {}
    for name in BASE_FILES:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or linked base file: {name}')
        metadata = get_hf_file_metadata(hf_hub_url(model, name, revision=revision))
        if metadata.commit_hash != revision or metadata.size != path.stat().st_size:
            raise ValueError(f'Base revision/size mismatch: {name}')
        hashes[name] = digest(path)
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
