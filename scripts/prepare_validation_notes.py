"""Normalize generated JSONL notes as data; resolve spans only in exact contexts."""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def occurrences(text, part):
    if not part:
        raise ValueError('Empty anchor/context/literal')
    at = text.find(part)
    while at >= 0:
        yield at
        at = text.find(part, at + 1)


def contextual_span(text, context, mention):
    matches = [(at + offset, at + offset + len(mention))
               for at in occurrences(text, context) for offset in occurrences(context, mention)]
    if len(matches) != 1:
        raise ValueError(f'Expected one exact contextual span; found {len(matches)} for {mention!r}')
    start, end = matches[0]
    return {'start': start, 'end': end, 'text': text[start:end]}


def normalize(source):
    source = Path(source)
    rows = [json.loads(line) for line in source.read_text(encoding='utf-8').splitlines() if line.strip()]
    notes, enums, families, ids = [], defaultdict(set), Counter(), set()
    for row in rows:
        if row.get('ok') is not True or row['id'] in ids:
            raise ValueError('Expected successful notes with unique IDs')
        ids.add(row['id'])
        text = row['payload']['text']
        references = []
        for frame in row['payload']['frames']:
            choices = {}
            for choice in frame['choices']:
                key, value = choice.split('=', 1)
                if key in choices or not key or not value:
                    raise ValueError('Invalid or duplicate reference choice')
                choices[key] = value
                enums[key].add(value)
            references.append({'family': frame['family'],
                               'anchor': contextual_span(text, frame['context'], frame['anchor']),
                               'choices': choices,
                               'literals': [{'field': literal['field'],
                                             **contextual_span(text, frame['context'], literal['text'])}
                                            for literal in frame['literals']]})
            families[frame['family']] += 1
        notes.append({'id': row['id'], 'text': text, 'noteKind': row['scenario']['note_kind'],
                      'noteType': row['scenario']['note_type'], 'references': references})
    fields = {key: {'type': 'enum', 'values': sorted(enums[key])}
              for key in ['assertion', 'time_frame', 'experiencer']}
    schema = {'id': 'generated-p40-common-fields', 'version': '1', 'families': {
        family: {'label': family, 'fields': {'concept': {'type': 'text'}, **fields,
                 **({'time_text': {'type': 'span'}} if family == 'condition_occurrence' else {})}}
        for family in sorted(families)}}
    return {'format': 'nextmedtator-generated-validation-v1',
            'source': {'filename': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                       'generatorModels': sorted({row['provenance']['model'] for row in rows}),
                       'referenceKind': 'externally-generated-labels', 'referenceCompleteness': 'unverified',
                       'clinicalGoldStandard': False},
            'schema': schema, 'allReferenceEnums': {k: sorted(v) for k, v in sorted(enums.items())},
            'scope': {'anchors': 'all six supplied families', 'enums': ['assertion', 'time_frame', 'experiencer'],
                      'literals': {'condition_occurrence': ['time_text']},
                      'unvalidated': 'Other fields remain in references but are not silently qualified by this gate'},
            'counts': {'notes': len(notes), 'anchors': sum(families.values()),
                       'literals': sum(len(r['literals']) for n in notes for r in n['references']),
                       'families': dict(sorted(families.items()))}, 'notes': notes}


def agreement(notes, results):
    """Exact family+code-point span matching; generated references are not human truth."""
    if len(notes) != len(results):
        raise ValueError('Missing note results')
    aggregate = Counter()
    by_family = defaultdict(Counter)
    attrs = defaultdict(Counter)
    literal_agreement = Counter()
    rows = []
    for note, result in zip(notes, results):
        gold = defaultdict(list)
        for reference in note['references']:
            anchor = reference['anchor']
            gold[(reference['family'], anchor['start'], anchor['end'])].append(reference)
        predicted = Counter()
        for record in result['records']:
            anchor = record['anchor'][0]
            key = record['family'], anchor['start'], anchor['end']
            predicted[key] += 1
            if gold[key]:
                reference = gold[key].pop(0)
                for field in ['assertion', 'time_frame', 'experiencer']:
                    if field in reference['choices']:
                        attrs[field]['matchedAnchorsWithReference'] += 1
                        attrs[field]['agree'] += record['fields'][field] == reference['choices'][field]
                if reference['family'] == 'condition_occurrence':
                    expected_time = {(x['start'], x['end']) for x in reference['literals'] if x['field']=='time_text'}
                    if expected_time:
                        actual_time = {(x['start'], x['end']) for x in record['fields']['time_text'] or []}
                        literal_agreement['matchedAnchorsWithTimeReference'] += 1
                        literal_agreement['exactTimeSpansAgree'] += actual_time == expected_time
        expected = Counter((r['family'], r['anchor']['start'], r['anchor']['end']) for r in note['references'])
        counts = {'reference': sum(expected.values()), 'predicted': sum(predicted.values()),
                  'matched': sum((expected & predicted).values())}
        aggregate.update(counts)
        for family in set(k[0] for k in expected) | set(k[0] for k in predicted):
            by_family[family].update({k: sum(v for key, v in counter.items() if key[0] == family)
                                     for k, counter in [('reference', expected), ('predicted', predicted), ('matched', expected & predicted)]})
        rows.append({'id': note['id'], **counts, 'status': result['status'], 'windows': len(result['windows'])})
    def scores(counts):
        p = counts['matched'] / counts['predicted'] if counts['predicted'] else 0
        r = counts['matched'] / counts['reference'] if counts['reference'] else 0
        return {**counts, 'precisionAgreement': p, 'recallAgreement': r, 'f1Agreement': 2*p*r/(p+r) if p+r else 0}
    return {'interpretation': 'Agreement with unverified generated references, not clinical accuracy',
            'exactAnchors': scores(aggregate), 'byFamily': {f: scores(c) for f, c in sorted(by_family.items())},
            'enumAgreementOnExactMatchedAnchors': {f: {**c, 'fractionAgree': c['agree']/c['matchedAnchorsWithReference']}
                                                 for f, c in sorted(attrs.items())},
            'conditionTimeLiteralAgreementOnMatchedAnchors': dict(literal_agreement), 'notes': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    fixture = normalize(args.source)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(fixture, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(fixture['counts']))
