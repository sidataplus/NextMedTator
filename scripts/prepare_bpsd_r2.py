"""Prepare this exact qualified BPSD export for R2; no upload or access grant.

The input is a private qualification archive, not a public download. Only an
audited allowlist leaves it. No source-note text, token IDs, private DTD, export
of annotations, screenshot, or full corpus report is included in output.
"""
import argparse
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUALIFIED_ARCHIVE = '799aba4b6b2d68874a583dc5a3f53d47748feb714dc8123b7ecc4ced9feeb821'
BASE = 'ca906247640776a07753514055be9726f9080ead'
ADAPTER = '5cb60383b4b8dd361841e307e54f6e17b68b6fa7'
PUBLIC_CONTRACT = '37889e4338ebc5c00a6f9e563599894a9ee3e611f4fb90348d052e69d4fb4533'
SAFE_FILES = {'model.onnx', 'attributes.onnx', 'tokenizer.json',
              'entity-contract.json', 'attributes-reference.json'}
RANDOM_HEAD = '8a2546dd5a41c58e89c85ae2992c4f215f386df24f5a369d89eeaf3d82a86281'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(source, out, public_contract):
    if out.exists():
        raise ValueError('Refusing to overwrite a prepared publication directory')
    if digest(source) != QUALIFIED_ARCHIVE:
        raise ValueError('This is not the exact privately qualified export')
    # public_contract must be compiled independently from pinned public HF JSON,
    # using compile_entity_contract.py. Never supply the private DTD here.
    compiled = json.loads(public_contract.read_text())
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='r2-model-', dir=out.parent) as scratch:
        staging = Path(scratch)
        with zipfile.ZipFile(source) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            if (manifest['lineage']['base']['revision'] != BASE
                    or manifest['lineage']['adapter']['revision'] != ADAPTER
                    or manifest['lineage']['merge'] != 'merged-export'):
                raise ValueError('Unexpected model lineage')
            files = [file for file in manifest['files'] if file['path'] in SAFE_FILES]
            if {file['path'] for file in files} != SAFE_FILES:
                raise ValueError('Audited artifacts are missing')
            for file in files:
                with archive.open(file['path']) as src, (staging/file['path']).open('xb') as target:
                    shutil.copyfileobj(src, target, 1024*1024)
                path = staging/file['path']
                if path.stat().st_size != file['bytes'] or digest(path) != file['sha256']:
                    raise ValueError('Qualified artifact integrity mismatch')
            if (digest(staging/'entity-contract.json') != PUBLIC_CONTRACT
                    or compiled != json.loads((staging/'entity-contract.json').read_text())):
                raise ValueError('Contract differs from the independently compiled public model schema')
            # Audited source: export.head_feeds, seed 431, independent random latent
            # states. This digest excludes source text and encoder input token IDs.
            head = json.loads((staging/'attributes-reference.json').read_text())
            if (digest(staging/'attributes-reference.json') != RANDOM_HEAD
                    or head.get('graph') != 'attributes' or head.get('tokenRows') != []
                    or set(head['feeds']) != {'text_states', 'text_word_mask', 'query_states',
                                              'query_marker_mask', 'span_indices'}):
                raise ValueError('Numerical fixture is not the audited random-latent fixture')
        manifest['files'] = files
        manifest['id'] = 'bpsd-gliner25-base-r2'
        manifest['license'] = {
            'id': 'LicenseRef-Owner-Authorized-Delivery',
            'notice': 'Base: Apache-2.0; DeBERTa: MIT. Adapter delivery authorized by its owner. '
                      'The adapter repository declares no public reuse license; do not infer '
                      'Apache licensing for the adapter. See LICENSES and NOTICE.txt. '
                      'Clinical accuracy is unqualified.'}
        for variant in manifest['variants']:
            variant['fixtures'] = ['attributes-reference.json']
            variant['conformanceScope'] = 'numerical-heads-only'
        manifest['qualification'] = {
            'archiveSha256': QUALIFIED_ARCHIVE,
            'privateSyntheticSourceParity': {'cases': 30, 'spans': 139, 'labelsAndPresenceExact': True},
            'privateBrowserParity': {'cases': 32, 'browser': 'Chromium 151', 'backend': 'wasm',
                                    'precision': 'fp32', 'encodedTokenCapacity': 1024,
                                    'overCapacity': 'reject-without-truncation'},
            'clinicalValidation': False,
            'publicFixtureScope': 'Seed-431 random latent attribute-head tensors only; no note fixtures',
            'limitations': 'Desktop Chromium tested. Mobile, low-memory, Safari, Firefox and WebGPU unqualified.'}
        # Bind license/notice bytes into the immutable revision as well. They are
        # publication objects, separate from executable-runtime model file roles.
        notice_sources={'LICENSES/Apache-2.0.txt':ROOT/'LICENSE',
                        'LICENSES/DeBERTa-MIT.txt':ROOT/'licenses/model-delivery/DeBERTa-MIT.txt',
                        'LICENSES/audit.json':ROOT/'licenses/model-delivery/audit.json',
                        'NOTICE.txt':ROOT/'licenses/model-delivery/NOTICE.txt'}
        manifest['files'].extend({'path':name,'bytes':path.stat().st_size,'sha256':digest(path),'role':'notice'}
                                 for name,path in sorted(notice_sources.items()))
        # Match the browser's canonical JSON for integral floats (e.g. 1.0 -> 1).
        def integers(value):
            if isinstance(value, float) and value.is_integer():return int(value)
            if isinstance(value, list):return [integers(v) for v in value]
            if isinstance(value, dict):return {k:integers(v) for k,v in value.items()}
            return value
        manifest=integers(manifest)
        raw = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        revision = hashlib.sha256(raw).hexdigest()
        payload = staging/'payload'
        payload.mkdir()
        for name in SAFE_FILES:
            (staging/name).rename(payload/name)
        (payload/'manifest.json').write_bytes(raw)
        licenses = payload/'LICENSES'
        licenses.mkdir()
        for name,path in notice_sources.items():shutil.copyfile(path,payload/name)
        metadata = {'revision': revision, 'prefix': f'/nextmedtator-models/{revision}/',
                    'objects': [{'path': p.relative_to(payload).as_posix(), 'bytes': p.stat().st_size,
                                 'sha256': digest(p)} for p in sorted(payload.rglob('*')) if p.is_file()],
                    'uploaded': False, 'account': None, 'bucket': None, 'publicAccess': 'unresolved'}
        (staging/'publication-plan.json').write_text(json.dumps(metadata, indent=2))
        # Keep the actual object prefix and metadata explicit; no invented destination.
        out.mkdir()
        shutil.move(str(payload), out/revision)
        shutil.copyfile(staging/'publication-plan.json', out/'publication-plan.json')
    return metadata


def catalog(prepared, origin):
    from model_delivery import r2_catalog
    # Validate through the same build-time path without persisting environment changes.
    import os
    metadata = json.loads((prepared/'publication-plan.json').read_text())
    entry = {'revision': metadata['revision'], 'delivery': {'kind': 'r2', 'origin': origin,
             'prefix': metadata['prefix']}, 'manifest': json.loads((prepared/metadata['revision']/'manifest.json').read_text())}
    entry['urls'] = {f['path']: origin+metadata['prefix']+f['path'] for f in entry['manifest']['files']}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as file:
        json.dump({'entries': [entry]}, file);file.flush()
        old = os.environ.get('NMT_MODEL_CATALOG')
        try:
            os.environ['NMT_MODEL_CATALOG'] = file.name
            return r2_catalog()
        finally:
            if old is None:os.environ.pop('NMT_MODEL_CATALOG', None)
            else:os.environ['NMT_MODEL_CATALOG'] = old


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('--archive', type=Path, required=True)
    prep.add_argument('--public-contract', type=Path, required=True)
    prep.add_argument('--out', type=Path, required=True)
    cat = commands.add_parser('catalog')
    cat.add_argument('--prepared', type=Path, required=True)
    cat.add_argument('--origin', required=True, help='Verified existing HTTPS model hostname; no credentials')
    cat.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        metadata = prepare(args.archive, args.out, args.public_contract)
        print(json.dumps({'revision': metadata['revision'], 'objects': len(metadata['objects']), 'uploaded': False}))
    else:
        data = catalog(args.prepared, args.origin)
        with args.out.open('x') as file:json.dump(data, file, indent=2)
        print('Prepared reviewed R2 catalog metadata; no upload, CORS change or access grant.')
