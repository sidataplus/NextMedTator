"""Keep supplied text/references fixed while declaring the adapter's inference protocol."""
import copy
import json
import zipfile

V3_CODEC = 'gliner25-clinical-v3-spans-v1'
DEFAULT_PACKAGE = '/workspace/work/clinical-v3-base.nmt-model.zip'


def validation_fixture(fixture, package):
    fixture = copy.deepcopy(fixture)
    with zipfile.ZipFile(package) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        variant = manifest['variants'][0]
        if variant['codec'] != V3_CODEC:
            return fixture, manifest
        registry = json.loads(archive.read(variant['clinicalSchema']))
    fixture['schema']['id'] = 'generated-p40-v3-shared-axes'
    fixture['schema']['clinicalV3'] = True
    family_order=[next(family for family,definition in registry['families'].items() if definition['entity_type']==label) for label in registry['core_entities']]
    fixture['schema']['families']={family:fixture['schema']['families'][family] for family in family_order}
    for family, definition in fixture['schema']['families'].items():
        definition['label'] = registry['families'][family]['entity_type']
        definition['fields'] = {name: spec for name, spec in definition['fields'].items() if name in ['concept', *registry['shared_axes']]}
    fixture['scope'] = {'anchors': 'all six supplied families with verbatim v3 core descriptions',
                        'enums': list(registry['shared_axes']), 'literals': {},
                        'unvalidated': 'Family-specific field spans and record bindings are not exposed by the v3 decoder',
                        'protocol': f"v3 qualified AttributeGroups at frozen threshold {variant['threshold']}; differs from archived P4/P7b protocol"}
    return fixture, manifest
