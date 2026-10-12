"""Exact pinned BPSD inference on local notes; never starts a service or uploads text.

Run with the existing locked exporter environment. The browser consumes the
resulting review bundle; it does not execute this adapter's native contract.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

REPOSITORY = 'na399/bpsd-gliner2.5-base-lora-20261012'
REVISION = '5cb60383b4b8dd361841e307e54f6e17b68b6fa7'
BASE = {'id': 'fastino/gliner2.5-base-v1', 'revision': 'ca906247640776a07753514055be9726f9080ead'}
RUNTIME = '55656fbfa01d3d4a77485e1a1eeeaf682990ccdf'
EXPECTED = {
    'adapter_config.json': 'fd71d10bdc9071c3ce060fc6abd2c4eb437b63a671aa6b5296b0cc007688544f',
    'adapter_model.safetensors': 'a0f26c79c4d1d87cf617105d1fc551b0f67e6458db1b3afc82bac782489b9ad8',
    'schema.json': '82319088384284e251d9d1e0a4c4d33c6acf3c747700976a518f22e25cfa3321',
}


def verify_adapter(root):
    for name, expected in EXPECTED.items():
        path = root / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned adapter integrity check failed: ' + name)
    settings = json.loads((root / 'inference_settings.json').read_bytes())
    if (settings['baseModel'] != BASE or settings['runtimeCommit'] != RUNTIME
            or settings['threshold'] != .5 or settings['overlapPolicy'] != 'allow'
            or settings['maxEncodedTokens'] != 1024):
        raise ValueError('Adapter inference contract differs from the pinned release')
    return settings, json.loads((root / 'schema.json').read_bytes())


def build_schema(model, spec):
    from gliner2 import AttributeGroup
    schema = model.create_schema().entities({e['label']: e['description'] for e in spec['entities']})
    schema.entity_attributes({axis['label']: AttributeGroup(
        [axis['label'] + ': ' + value['label'] for value in axis['values']],
        qualify_labels=False,
        applies_to=[e['label'] for e in spec['entities'] if e['id'] in axis['appliesTo']],
    ) for axis in spec['attributes']})
    return schema


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter', type=Path, required=True)
    parser.add_argument('--notes', type=Path, required=True, help='Local JSON array or object with notes: [{id,text}]')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=4, choices=range(1, 9))
    parser.add_argument('--offline', action='store_true', help='Require the pinned base in the HF cache')
    args = parser.parse_args()
    if args.out.exists():
        parser.error('Refusing to overwrite an existing receipt')
    settings, spec = verify_adapter(args.adapter)
    source = json.loads(args.notes.read_bytes())
    notes = source['notes'] if isinstance(source, dict) else source
    if not isinstance(notes, list) or not 1 <= len(notes) <= 10000:
        parser.error('Provide 1–10,000 local notes')
    ids = set()
    for note in notes:
        if (not isinstance(note.get('id'), str) or note['id'] in ids
                or not isinstance(note.get('text'), str) or not note['text'].strip()):
            parser.error('Each note needs a unique string id and nonempty text')
        ids.add(note['id'])
    import torch
    import gliner2
    import transformers
    import peft
    from huggingface_hub import snapshot_download
    # The installed Git dependency must resolve to the declared runtime.
    direct = next(Path(gliner2.__file__).parent.parent.glob('gliner2-*.dist-info/direct_url.json'))
    if json.loads(direct.read_bytes())['vcs_info']['commit_id'] != RUNTIME:
        raise ValueError('Install the pinned GLiNER2 runtime with tools/gliner-onnx/uv.lock')
    torch.set_num_threads(args.threads)
    base = snapshot_download(BASE['id'], revision=BASE['revision'], local_files_only=args.offline)
    model = gliner2.AutoExtractor.from_pretrained(base).eval()
    model.load_adapter(str(args.adapter))
    schema = build_schema(model, spec)
    rows = []
    for index, note in enumerate(notes):
        batch = model.processor.collate_fn_inference([(note['text'], schema.build())],
            max_len=None, error_policy='raise', architecture='boundary',
            build_targets=False, on_capacity_exceeded='raise')
        tokens = int(batch.attention_mask[0].sum().item())
        row = {'id': note['id'], 'text': note['text'], 'encodedTokens': tokens}
        if tokens > 1024:
            row['status'] = 'unsupported'
            row['reason'] = 'Encoded input including schema exceeds 1024 tokens; no truncation or windowing applied'
        else:
            started = time.perf_counter()
            with torch.inference_mode():
                result = model.extract(note['text'], schema, threshold=.5,
                    include_spans=True, include_confidence=True, overlap_policy='allow')
            row.update(status='complete', result=result, inferenceMs=round((time.perf_counter()-started)*1000, 2))
        rows.append(row)
        # Never log note text, identifiers, schema source, attributes or predictions.
        print(f'{index+1}/{len(notes)}: {row["status"]}', flush=True)
    receipt = {'format': 'nextmedtator-native-predictions-v1',
        'model': {'repository': REPOSITORY, 'revision': REVISION, 'base': BASE,
            'runtimeCommit': RUNTIME, 'artifacts': settings['files']},
        'settings': {'threshold': .5, 'maxEncodedTokens': 1024, 'overlapPolicy': 'allow', 'clinicalValidation': False},
        'runtime': {'torch': torch.__version__, 'transformers': transformers.__version__,
            'peft': peft.__version__, 'device': 'cpu', 'threads': args.threads},
        'schema': spec, 'notes': rows}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
        output.write('\n')


if __name__ == '__main__':
    main()
