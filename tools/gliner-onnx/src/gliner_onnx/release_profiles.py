"""Pinned releases with complete prompts; downloaded Python is verified before import."""
import json
from pathlib import Path
from .inputs import digest, BASE_FILES

P10_REVISION = 'ffd6e47bd55de93dcc3fcabbb65533ad7ba32991'
P10_MANIFEST = 'f38bebbd0a8747ee3eb9c39626156cd63758b3e9379d4c6673746351cec0a63e'
P10_RUNTIME = 'b86d35c02f2c1a4d9840ea50197bd1b6d13b031e'
PROFILES = {
    'clinical-p10': ('na399/clinical-evidence-gliner2.5-base-lora-p10-glm', P10_REVISION, '54785d51df8d86a0d8f2eb212fec15871aad2c4d'),
    'bpsd-base': ('na399/bpsd-gliner2.5-base-lora-20261012', '5cb60383b4b8dd361841e307e54f6e17b68b6fa7', 'ca906247640776a07753514055be9726f9080ead'),
}


def verify_p10(root):
    root = Path(root).resolve()
    if digest(root/'package-manifest.json') != P10_MANIFEST:
        raise ValueError('P10 package manifest differs from the pinned release')
    manifest = json.loads((root/'package-manifest.json').read_text(encoding="utf-8"))
    for name, expected in manifest['files'].items():
        path = root/name
        if not path.resolve().is_relative_to(root) or path.is_symlink() or digest(path) != expected:
            raise ValueError('P10 release asset mismatch: '+name)
    return json.loads((root/'release.json').read_text(encoding="utf-8"))


def p10_contract(root):
    release = verify_p10(root)
    ontology = json.loads((Path(root)/'ontology.json').read_text(encoding="utf-8"))
    entities = [{'family':f['canonical'], 'label':f['model_label'], 'description':f['description']} for f in ontology['families'].values()]
    from .entity_contract import validate_contract
    return validate_contract({'format':'nextmedtator-entity-attributes-v1',
        'entities':entities, 'attributes':[{'field':axis, 'labels':[{'label':v,'value':v} for v in values],
            'appliesTo':[e['label'] for e in entities], 'qualifyLabels':True, 'selection':'single'} for axis,values in ontology['axes'].items()],
        'threshold':release['inference']['threshold'], 'maxEncodedTokens':512, 'maxWords':384,
        'overlapPolicy':'flat', 'contextPolicy':'reject'})


def prepare(args):
    from huggingface_hub import snapshot_download
    from .entity_contract import contract_from_schema
    repository, revision, base_revision = PROFILES[args.selection]
    if args.adapter or args.adapter_repository or args.adapter_revision or args.base_model or args.base_revision or args.entity_contract or args.runtime_package_dir:
        raise ValueError('Pinned model profiles do not accept adapter/base/contract/runtime overrides; use --release-dir and --base-dir for cached files')
    args.work_dir.mkdir(parents=True,exist_ok=True)
    root = args.release_dir or Path(snapshot_download(repository,revision=revision,local_dir=args.work_dir/args.selection))
    if args.selection == 'clinical-p10':
        contract = p10_contract(root)
        args.p10_release = root
    else:
        contract = contract_from_schema(json.loads((root/'schema.json').read_text(encoding="utf-8")),json.loads((root/'inference_settings.json').read_text(encoding="utf-8")))
    args.entity_contract = args.work_dir/(args.selection+'-contract.json')
    args.entity_contract.write_text(json.dumps(contract,ensure_ascii=False),encoding='utf-8')
    args.adapter, args.adapter_repository, args.adapter_revision = root, repository, revision
    args.base_model, args.base_revision = 'fastino/gliner2.5-base-v1', base_revision
    if not args.base_dir:
        args.base_dir = Path(snapshot_download(args.base_model,revision=base_revision,allow_patterns=list(BASE_FILES),local_dir=args.work_dir/'base'/base_revision))
    args.id = args.id or ('clinical-evidence-p10-base' if args.selection == 'clinical-p10' else 'bpsd-gliner25-base')
    args.adapter_license = 'LicenseRef-Private-Research' if args.selection == 'clinical-p10' else 'LicenseRef-User-Provided'
    if not args.cases:
        args.cases = args.work_dir/(args.selection+'-synthetic.json')
        args.cases.write_text(json.dumps([{'text':t} for t in [
            'The patient has fever. Aspirin is planned for tomorrow.',
            'Her mother has diabetes. The patient denies pain.',
            'She is pacing, shouting and resisting morning care. No hallucinations.',
            'Café 👩‍⚕️. The patient was agitated last year and is agitated today.'
        ]]),encoding='utf-8')
    return args
