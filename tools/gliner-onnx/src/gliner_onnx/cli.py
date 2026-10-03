"""Merge arbitrary compatible GLiNER2.5 LoRA inputs and export a verified package."""
import argparse
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path

from .inputs import BASE_FILES, digest, read_adapter, resolve_base, verify_base

SOURCE_REVISION = '55656fbfa01d3d4a77485e1a1eeeaf682990ccdf'
CODEC = 'gliner25-records-v1'
CASES = [
    ('The patient has diabetes and takes metformin.', ['diagnosis', 'medication', 'symptom']),
    ('John works at Google in Seattle.', ['person', 'organization', 'location']),
    ('Her mother has diabetes. The patient denies diabetes.', ['condition']),
    ('The patient has breast cancer and takes aspirin.', ['disease', 'drug']),
    ('Diabetes.', ['diagnosis']),
    ('No diagnosis is documented. Café 👩‍⚕️.', ['diagnosis', 'medication']),
]


def merge_adapter(model, adapter):
    import torch
    from peft import PeftModel, PeftConfig, get_peft_model_state_dict
    from safetensors.torch import load_file
    state = load_file(str(Path(adapter)/'adapter_model.safetensors'))
    probe = torch.tensor([[1, 20, 50, 70, 80, 90, 100, 2]])
    with torch.no_grad():
        base = model.encoder(input_ids=probe, attention_mask=torch.ones_like(probe)).last_hidden_state.clone()
    config = PeftConfig.from_pretrained(str(adapter))
    config.base_model_name_or_path = model.name_or_path
    wrapped = PeftModel.from_pretrained(model, str(adapter), config=config, is_trainable=False).eval()
    loaded = get_peft_model_state_dict(wrapped)
    if set(state) != set(loaded) or any(not torch.equal(state[k], loaded[k].cpu()) for k in state):
        raise ValueError('Adapter tensors were not loaded exactly; incompatible targets or missing weights')
    with torch.no_grad():
        active = wrapped.encoder(input_ids=probe, attention_mask=torch.ones_like(probe)).last_hidden_state.clone()
    merged = wrapped.merge_and_unload(safe_merge=True).eval()
    with torch.no_grad():
        actual = merged.encoder(input_ids=probe, attention_mask=torch.ones_like(probe)).last_hidden_state
    delta = float((active-actual).abs().max())
    if not torch.allclose(active, actual, atol=1e-4, rtol=1e-4):
        raise ValueError(f'Merged adapter changed active-adapter output by {delta}')
    if any('lora_' in name for name, _ in merged.named_parameters()):
        raise ValueError('Unmerged adapter parameters remain')
    heads = {k: v for k, v in state.items() if not k.startswith('base_model.model.encoder.')}
    h = hashlib.sha256()
    for key, value in sorted(heads.items()):
        h.update(key.encode()+b'\0'+value.contiguous().view(torch.uint8).numpy().tobytes())
    return merged, {'activeToMergedMaxAbsoluteError': delta, 'baseToAdapterEncoderMaxAbsoluteChange': float((base-active).abs().max()), 'adapterTensorCount': len(state),
                    'trainedHeads': h.hexdigest() if heads else 'unchanged'}


def source_cases(model, cases):
    from .export import MAIN_INPUTS, WORDS
    import torch
    from gliner2.training.trainer import ExtractorCollator
    from gliner2.processing.word_splitter import WhitespaceTokenSplitter
    captures = []
    collate = ExtractorCollator(model.processor, is_training=False, architecture=model.architecture)
    for text, labels in cases:
        if not text or len(labels) < 1 or len(labels) > 64 or len(set(labels)) != len(labels):
            raise ValueError('Validation cases need text and 1–64 unique labels')
        schema = model.create_schema().entities(labels)
        result = model.extract_entities(text, labels, include_confidence=True, include_spans=True)
        schemas, _ = model._build_schema_dicts_and_metadata([schema])
        batch = collate([(text, schemas[0])])
        feeds = {}
        for name in MAIN_INPUTS:
            value = getattr(batch, name, None)
            if value is None or value.shape[1] == 0:
                value = torch.zeros(1, 1, dtype=torch.long if 'indices' in name else torch.float32)
            if 'mask' in name and name != 'attention_mask':
                value = value.float()
            feeds[name] = value
        # Source has no relation-role routes on this schema; the browser sends one masked dummy.
        feeds['rel_marker_indices'] = torch.zeros(1, 1, dtype=torch.long)
        feeds['rel_marker_mask'] = torch.zeros(1, 1)
        if feeds['input_ids'].shape[1] > 512 or feeds['text_word_indices'].shape[1] > WORDS:
            raise ValueError('Each source validation case must fit the 512-token browser window')
        word_count = feeds['text_word_indices'].shape[1]
        for name in ('text_word_indices', 'text_word_mask'):
            feeds[name] = torch.nn.functional.pad(feeds[name], (0, WORDS-word_count))
        rows = []
        for label, hits in result['entities'].items():
            for hit in hits:
                rows.append({'id': str(len(rows)), 'documentId': 'pending', 'family': label,
                             'anchor': [{'start': hit['start'], 'end': hit['end'], 'text': hit['text']}],
                             'fields': {'concept': hit['text']}, 'evidence': []})
        app_schema = {'id': 'export-source-case', 'version': '1',
                      'families': {label: {'label': label, 'fields': {'concept': {'type': 'text'}}} for label in labels}}
        tokens = [token for group in batch.schema_tokens_list[0] for token in group] + ['[SEP_TEXT]'] + [row[0] for row in WhitespaceTokenSplitter()(text)]
        token_rows = [{'text': token, 'ids': model.processor.tokenizer.encode(token, add_special_tokens=False)} for token in dict.fromkeys(tokens)]
        captures.append({'text': text, 'labels': labels, 'schema': app_schema, 'records': rows, 'tokenRows': token_rows,
                         'source': result, 'feeds': feeds, 'threshold': .5})
    return captures


def export_model(model, captures, output):
    import torch
    import numpy as np
    from .export import (MAIN_INPUTS, MAIN_OUTPUTS, Main, export_graph, export_heads,
                         compare, fixture, prepare_web_attention, session, head_feeds, Attributes)
    wrapper = Main(model).eval()
    # Capture the unmodified PyTorch head before replacing attention with equivalent web math.
    with torch.no_grad():
        references = [dict(zip(MAIN_OUTPUTS, wrapper(*case['feeds'].values()))) for case in captures]
        attribute_source = Attributes(model)(*head_feeds(model.hidden_size)['attributes'].values())
    prepare_web_attention(model)
    dynamic = {name: {1: axis} for name, axis in zip(MAIN_INPUTS,
               ['tokens', 'tokens', None, None, 'queries', 'queries', 'choices', 'choices', 'roles', 'roles']) if axis}
    for name in MAIN_OUTPUTS:
        if name not in ['text_states']:
            dynamic[name] = {1: 'choices' if name == 'cls_logits' else 'roles' if name == 'rel_role_states' else 'queries'}
    _, export_error = export_graph(wrapper, captures[0]['feeds'], MAIN_OUTPUTS, output/'model.onnx', dynamic)
    native = session(output/'model.onnx')
    reports, paths = [], []
    for i, (case, reference) in enumerate(zip(captures, references)):
        actual = dict(zip(MAIN_OUTPUTS, native.run(None, {k: v.numpy() for k, v in case['feeds'].items()})))
        errors = compare(reference, actual)
        logits, indices, valid = actual['pair_logits'][0], actual['pair_indices'][0], actual['pair_valid'][0]
        # Verify retained native candidates against source predictions independently of the browser.
        from gliner2.processing.word_splitter import WhitespaceTokenSplitter
        from gliner2.inference.overlap import resolve_overlaps
        words = list(WhitespaceTokenSplitter()(case['text']))
        retained = []
        for qi, label in enumerate(case['labels']):
            scored = {}
            if float(1/(1+np.exp(-actual['null_logits'][0, qi]))) > model.boundary_settings.abstention_threshold:
                continue
            for ci, (start, end) in enumerate(indices[qi]):
                if not valid[qi, ci] or start >= end or start < 0 or end > len(words):
                    continue
                score = float(1/(1+np.exp(-logits[qi, ci]/model.boundary_settings.pair_temperature)))
                if score >= .5:
                    scored[(int(start), int(end))] = score
            selected = resolve_overlaps([(score, start, end) for (start, end), score in scored.items()],
                                        'flat', score=lambda r:r[0], start=lambda r:r[1], end=lambda r:r[2])
            for score, start, end in selected:
                retained.append((label, words[start][1], words[end-1][2], score))
        source = {(label, hit['start'], hit['end']): hit['confidence'] for label, hits in case['source']['entities'].items() for hit in hits}
        if set(source) != {r[:3] for r in retained} or any(abs(r[3]-source[r[:3]]) > 1e-4 for r in retained):
            raise ValueError(f'Native ONNX/source extraction mismatch in case {i}')
        public_case = {k: case[k] for k in ['text', 'schema', 'records', 'threshold']}
        public_case['origin'] = 'Merged official PyTorch source prediction; technical conformance, not clinical ground truth'
        case_path, raw_path = f'source-case-{i}.json', f'model-reference-{i}.json'
        (output/case_path).write_text(json.dumps(public_case, ensure_ascii=False, separators=(',', ':')))
        checks = {k: reference[k] for k in ['pair_indices', 'pair_logits', 'pair_valid', 'null_logits']}
        (output/raw_path).write_text(json.dumps(fixture('model', case['feeds'], checks, case['tokenRows']), separators=(',', ':')))
        paths.extend([case_path, raw_path])
        reports.append({'case': i, 'sourceSpansExact': True, 'sourceScoresWithinTolerance': True, 'outputErrors': errors})
    del native
    heads = export_heads(model, output, attribute_source)
    paths += sorted(path.name for path in output.glob('*-reference.json'))
    return paths, {'mainExportErrors': export_error, 'sourceCases': reports, 'heads': heads}


def build(args):
    from huggingface_hub import snapshot_download
    from gliner2 import AutoExtractor
    import torch
    torch.set_num_threads(args.threads)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        raise ValueError('Output already exists; choose a new --out path')
    with tempfile.TemporaryDirectory(prefix='lora-export-', dir=args.work_dir) as scratch:
        scratch = Path(scratch)
        adapter = scratch/'adapter'
        config, adapter_hash = read_adapter(args.adapter, adapter)
        base_model, revision = resolve_base(config, args.base_model, args.base_revision)
        base = args.base_dir or Path(snapshot_download(base_model, revision=revision,
                    allow_patterns=list(BASE_FILES), local_dir=args.work_dir/'base'))
        hashes = verify_base(base, base_model, revision)
        model = AutoExtractor.from_pretrained(str(base), map_location='cpu', local_files_only=True).eval()
        if model.record_decoder is None or model.relation_scorer is None:
            raise ValueError('This record codec requires both record and relation scoring heads')
        model, merge_report = merge_adapter(model, adapter)
        cases = CASES
        if args.cases:
            cases = [(row['text'], row['labels']) for row in json.loads(args.cases.read_text())]
        if not cases or len(cases) > 32:
            raise ValueError('Provide 1–32 source conformance cases')
        captures = source_cases(model, cases)
        graphs = scratch/'graphs'
        graphs.mkdir()
        fixtures, export_report = export_model(model, captures, graphs)
        model.processor.tokenizer.save_pretrained(str(graphs))
        package_id = args.id or base_model.split('/')[-1]+'-lora-'+adapter_hash[:12]
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', package_id):
            raise ValueError('Invalid package ID')
        names = ['model.onnx', 'attributes.onnx', 'records.onnx', 'relations.onnx', 'tokenizer.json', *fixtures]
        files = []
        for name in names:
            path = graphs/name
            if path.stat().st_size > 768*1024*1024:
                raise ValueError(f'Graph exceeds browser package member limit: {name}')
            files.append({'path': name, 'bytes': path.stat().st_size, 'sha256': digest(path),
                          'role': 'graph' if name.endswith('.onnx') else 'tokenizer' if name=='tokenizer.json' else 'fixture'})
        if sum(f['bytes'] for f in files) > 1024*1024*1024:
            raise ValueError('Package exceeds browser total size limit')
        manifest = {'format': 'nextmedtator-model-v1', 'id': package_id, 'version': adapter_hash,
                    'runtime': 'onnxruntime-web', 'runtimeVersion': '1.23.2',
                    'lineage': {'base': {'model': base_model, 'revision': revision, 'files': hashes},
                                'adapter': {'sha256': adapter_hash, 'baseRevision': revision,
                                            'weightsSha256': digest(adapter/'adapter_model.safetensors'),
                                            'configSha256': digest(adapter/'adapter_config.json')},
                                'merge': 'merged-export', 'trainedHeads': merge_report['trainedHeads']},
                    'license': {'id': args.adapter_license, 'notice': 'Base '+base_model+': '+args.base_license+'. Adapter: '+args.adapter_license+'. Export conformance does not establish clinical accuracy.'},
                    'files': files, 'capabilities': ['*'], 'variants': [{
                        'id': 'wasm-fp32', 'backend': 'wasm', 'precision': 'fp32', 'codec': CODEC,
                        'graph': 'model.onnx', 'graphs': {k: k+'.onnx' for k in ['model', 'attributes', 'records', 'relations']},
                        'tokenizer': 'tokenizer.json', 'fixtures': fixtures, 'threshold': .5,
                        'fixedWords': 512, 'maxSequenceLength': 512, 'wordOverlap': 32,
                        'pairTemperature': model.boundary_settings.pair_temperature,
                        'abstentionThreshold': model.boundary_settings.abstention_threshold,
                        'automaticRelations': False, 'sourceCodeRevision': SOURCE_REVISION,
                        'exporterVersion': '0.1.0', 'languageClaims': ['en']} ]}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        # Write in the destination filesystem, verify before publishing atomically.
        with tempfile.NamedTemporaryFile(prefix='model-', suffix='.zip', dir=args.out.parent, delete=False) as temp:
            temporary = Path(temp.name)
        try:
            with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('manifest.json', json.dumps(manifest, separators=(',', ':')))
                for name in names:
                    archive.write(graphs/name, name)
            if temporary.stat().st_size > 1024*1024*1024:
                raise ValueError('Archive exceeds browser package limit')
            with zipfile.ZipFile(temporary) as archive:
                if archive.testzip():
                    raise ValueError('Archive read-back failed')
            temporary.replace(args.out)
        finally:
            temporary.unlink(missing_ok=True)
        report = {'packageId': package_id, 'packageBytes': args.out.stat().st_size,
                  'packageSha256': digest(args.out), 'base': manifest['lineage']['base'],
                  'adapter': manifest['lineage']['adapter'], 'merge': merge_report, 'export': export_report,
                  'sourceCodeRevision': SOURCE_REVISION, 'exporterVersion': '0.1.0',
                  'scope': 'Technical source/ONNX conformance on synthetic English cases; no clinical accuracy claim'}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2)+'\n')
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter', type=Path, required=True)
    parser.add_argument('--base-model')
    parser.add_argument('--base-revision')
    parser.add_argument('--base-dir', type=Path, help='Optional verified local base checkpoint')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, default=Path('work/gliner-onnx'))
    parser.add_argument('--cases', type=Path, help='Optional synthetic conformance JSON list: {text,labels}')
    parser.add_argument('--adapter-license', default='LicenseRef-User-Provided')
    parser.add_argument('--base-license', default='LicenseRef-Hub-Base', help='License declared by the pinned base model card')
    parser.add_argument('--id')
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.threads <= 32:
        parser.error('--threads must be 1–32')
    try:
        report = build(args)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps({k: report[k] for k in ['packageId', 'packageBytes', 'packageSha256']}))


if __name__ == '__main__':
    main()
