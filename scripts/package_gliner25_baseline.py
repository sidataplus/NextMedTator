"""Build a local nextmedtator-model-v1 zip for the published GLiNER2.5-base ONNX export.

Weights are not downloaded or committed by this script. Point --source at a directory that already
contains tokenizer.json, gliner2_config.json, onnx/encoder.onnx and onnx/boundary.onnx from
https://huggingface.co/DanKau/gliner2.5-base-v1-onnx (Apache-2.0, base revision recorded below).
"""
import argparse, hashlib, json, zipfile
from pathlib import Path
REVISION = '72ac19b486cd4557424c8d61114e7530c243e9b0'
def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    members = {
        'encoder.onnx': args.source / 'onnx/encoder.onnx',
        'boundary.onnx': args.source / 'onnx/boundary.onnx',
        'tokenizer.json': args.source / 'tokenizer.json',
        'gliner2_config.json': args.source / 'gliner2_config.json',
    }
    fixture = {
        'kind': 'gliner25-boundary-span-v1',
        'text': 'John works at Google in Seattle.',
        'labels': ['person', 'organization', 'location'],
        'expected': [
            {'label': 'person', 'text': 'John'},
            {'label': 'organization', 'text': 'Google'},
            {'label': 'location', 'text': 'Seattle'},
        ],
    }
    fixture_bytes = json.dumps(fixture, separators=(',', ':')).encode()
    files = []
    payload = {}
    for name, path in members.items():
        if not path.is_file():
            raise SystemExit(f'Missing {path}')
        data = path.read_bytes()
        payload[name] = data
        files.append({'path': name, 'bytes': len(data), 'sha256': sha256(path), 'role': 'graph' if name.endswith('.onnx') else 'tokenizer' if name.endswith('tokenizer.json') else 'schema'})
    payload['span-fixture.json'] = fixture_bytes
    files.append({'path': 'span-fixture.json', 'bytes': len(fixture_bytes), 'sha256': hashlib.sha256(fixture_bytes).hexdigest(), 'role': 'fixture'})
    manifest = {
        'format': 'nextmedtator-model-v1', 'id': 'gliner25-base-boundary', 'version': '2026-04-09',
        'runtime': 'onnxruntime-web', 'runtimeVersion': '1.23.2',
        'lineage': {'base': {'model': 'fastino/gliner2.5-base-v1', 'revision': REVISION}},
        'license': {'id': 'Apache-2.0', 'notice': 'ONNX export of fastino/gliner2.5-base-v1. Span extraction only; not a Clinical-Evidence adapter.'},
        'files': files,
        'variants': [{
            'id': 'wasm-fp32', 'backend': 'wasm', 'precision': 'fp32', 'codec': 'gliner25-boundary-span-v1',
            'graph': 'encoder.onnx', 'graphs': {'encoder': 'encoder.onnx', 'boundary': 'boundary.onnx'},
            'tokenizer': 'tokenizer.json', 'modelConfig': 'gliner2_config.json', 'fixtures': ['span-fixture.json'], 'threshold': 0.5,
        }],
        'capabilities': ['*'],
    }
    encoded = json.dumps(manifest, separators=(',', ':')).encode()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('manifest.json', encoded)
        for name, data in payload.items():
            archive.writestr(name, data)
    print(args.out, args.out.stat().st_size)
if __name__ == '__main__':
    main()
