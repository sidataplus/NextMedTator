"""Validate an exported semantic schema with a local clinical-evidence checkout.

This imports the upstream contract/registry only, without model or provider calls.
Pin the checkout revision separately; this command never downloads or updates it.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--schema', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo/'src'))
    from clinical_evidence.annotation.corpus.contracts import SemanticSchema
    from clinical_evidence.registry import registry_hash, registry, choices_for
    app_root = Path(__file__).resolve().parents[1]
    contract = json.loads(subprocess.check_output([
        'node', '--input-type=module', '-e',
        'import {CLINICAL_CONTRACT as c} from "./src/nextmedtator/clinical-contract.mjs"; console.log(JSON.stringify(c));'
    ], cwd=app_root, text=True))
    revision = subprocess.check_output(['git', '-C', str(args.repo), 'rev-parse', 'HEAD'], text=True).strip()
    assert revision == contract['revision'], 'Use the pinned training repository revision'
    assert registry_hash() == contract['registryHash'], 'Training registry fingerprint differs'
    expected = {}
    for family, definition in registry()['families'].items():
        fields = {}
        for name, field in definition['fields'].items():
            fields[name] = ({'kind': 'choice', 'values': choices_for(field), 'exportValues': choices_for(field, export=True)}
                            if field['kind'] == 'choice' else {'kind': 'literal', 'dtype': field.get('dtype', 'str')})
        expected[family] = {'anchor': definition['anchor'], 'entityType': definition['entity_type'], 'fields': fields}
    assert contract['families'] == expected, 'App families, anchors, field types or vocabularies differ from training'
    schema = SemanticSchema.model_validate(json.loads(args.schema.read_text()))
    schema.verify()
    print(json.dumps({'valid': True, 'validator': 'clinical_evidence.annotation.corpus.contracts.SemanticSchema.verify',
                      'revision': revision, 'registryHash': registry_hash(), 'schemaHash': schema.schema_hash,
                      'families': schema.families, 'concepts': len(schema.concepts), 'appContractMatchesRegistry': True}, indent=2))


if __name__ == '__main__':
    main()
