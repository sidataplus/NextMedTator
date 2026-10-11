"""Declarative entity/attribute contracts; no model-supplied executable code."""
import json, re
from pathlib import Path
FORMAT='nextmedtator-entity-attributes-v1'
CODEC='gliner25-entity-attributes-v1'
ID=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$')
def validate_contract(contract):
    if not isinstance(contract,dict) or contract.get('format')!=FORMAT:raise ValueError('Unsupported entity/attribute contract')
    if set(contract)-{'format','entities','attributes','threshold','maxEncodedTokens','overlapPolicy','contextPolicy'}:raise ValueError('Unknown entity contract key')
    if type(contract.get('maxEncodedTokens')) is not int or contract['maxEncodedTokens'] not in (512,1024):raise ValueError('Supported encoded-token limits are 512 and 1024')
    if contract.get('contextPolicy')!='reject' or contract.get('overlapPolicy') not in ('allow','flat'):raise ValueError('Explicit reject/overlap policies required')
    if type(contract.get('threshold')) not in (float,int) or not 0<=contract['threshold']<=1:raise ValueError('Invalid entity threshold')
    entities,groups=contract.get('entities'),contract.get('attributes')
    if not isinstance(entities,list) or not 1<=len(entities)<=64 or not isinstance(groups,list) or len(groups)>32:raise ValueError('Invalid contract inventory')
    labels=set();families=set();raw=set();fields=set()
    for entity in entities:
        if set(entity)!={'family','label','description'} or not ID.fullmatch(entity.get('family','')):raise ValueError('Invalid contract entity')
        if not isinstance(entity['label'],str) or not 0<len(entity['label'])<=200 or not isinstance(entity['description'],str) or len(entity['description'])>10000:raise ValueError('Invalid entity prompt')
        if entity['label'] in labels or entity['family'] in families:raise ValueError('Duplicate contract entity')
        labels.add(entity['label']);families.add(entity['family'])
    entity_labels=set(labels)
    for group in groups:
        if set(group)!={'field','labels','appliesTo','qualifyLabels','selection'} or not ID.fullmatch(group.get('field','')) or group['field'] in fields:raise ValueError('Invalid contract group')
        fields.add(group['field'])
        if group['selection']!='single' or type(group['qualifyLabels']) is not bool:raise ValueError('Only explicit single-value attribute groups are supported')
        if not isinstance(group['appliesTo'],list) or len(set(group['appliesTo']))!=len(group['appliesTo']) or not set(group['appliesTo'])<=entity_labels:raise ValueError('Unknown attribute applicability')
        if not isinstance(group['labels'],list) or not 1<=len(group['labels'])<=8:raise ValueError('Attribute graph supports 1–8 choices per group')
        values=set()
        for row in group['labels']:
            if set(row)!={'label','value'} or any(not isinstance(row[k],str) or not 0<len(row[k])<=200 for k in row):raise ValueError('Invalid attribute choice')
            prompt=f"{group['field']}: {row['label']}" if group['qualifyLabels'] else row['label']
            if row['label'] in raw or row['value'] in values or prompt in labels:raise ValueError('Attribute labels/values collide')
            raw.add(row['label']);values.add(row['value']);labels.add(prompt)
    if len(labels)>64:raise ValueError('Contract exceeds 64 complete prompt queries')
    return contract

def read_contract(path):
    if Path(path).stat().st_size>128*1024:raise ValueError('Entity contract exceeds 128 KiB')
    return validate_contract(json.loads(Path(path).read_text(encoding='utf-8')))

def build_schema(model,contract):
    from gliner2 import AttributeGroup
    schema=model.create_schema().entities({e['label']:e['description'] for e in contract['entities']})
    schema.entity_attributes({g['field']:AttributeGroup([r['label'] for r in g['labels']],qualify_labels=g['qualifyLabels'],applies_to=g['appliesTo']) for g in contract['attributes']})
    return schema

def app_schema(contract):
    families={}
    for entity in contract['entities']:
        families[entity['family']]={'label':entity['label'],'fields':{g['field']:{'type':'enum','values':[r['value'] for r in g['labels']]} for g in contract['attributes'] if entity['label'] in g['appliesTo']}}
    return {'id':'entity-contract','version':'1','families':families,'relations':{}}

def native_records(result,contract):
    records=[]
    by_label={e['label']:e for e in contract['entities']}
    for label,rows in result['entities'].items():
        for row in rows:
            fields={};scores={}
            for group in contract['attributes']:
                if group['field'] not in row:continue
                if label not in group['appliesTo']:raise ValueError('Source emitted an inapplicable attribute')
                selected=next(r for r in group['labels'] if r['label']==row[group['field']]['label'])
                fields[group['field']]=selected['value'];scores[group['field']]=row[group['field']]['confidence']
            records.append({'id':str(len(records)),'documentId':'pending','family':by_label[label]['family'],'anchor':[{'start':row['start'],'end':row['end'],'text':row['text']}],'fields':fields,'evidence':[],'score':row['confidence'],'attributeScores':scores})
    return records

def compare_records(expected,actual,tolerance=1e-4):
    def index(rows):return {(r['family'],r['anchor'][0]['start'],r['anchor'][0]['end']):r for r in rows}
    left,right=index(expected),index(actual)
    if len(left)!=len(expected) or len(right)!=len(actual) or set(left)!=set(right):raise ValueError('Native/ONNX exact entity spans differ')
    errors=[]
    for key,row in left.items():
        got=right[key]
        if row['fields']!=got['fields'] or row['anchor']!=got['anchor'] or set(row['attributeScores'])!=set(got['attributeScores']):raise ValueError('Native/ONNX attribute presence, value or applicability differs')
        errors.append(abs(row['score']-got['score']))
        errors.extend(abs(value-got['attributeScores'][field]) for field,value in row['attributeScores'].items())
    maximum=max(errors,default=0)
    if maximum>tolerance:raise ValueError(f'Native/ONNX confidence drift: {maximum}')
    return {'spans':len(left),'spansAndAttributesExact':True,'maxScoreError':maximum}


def verify_source_declaration(directory,contract):
    """A declared native contract cannot be overridden by an export configuration."""
    root=Path(directory);settings_path=root/'inference_settings.json'
    if not settings_path.exists():return
    settings=json.loads(settings_path.read_text())
    for key in ('maxEncodedTokens','overlapPolicy','threshold'):
        if settings.get(key)!=contract[key]:raise ValueError('Export contract differs from declared native '+key)
    if settings.get('runtimeCommit')!='55656fbfa01d3d4a77485e1a1eeeaf682990ccdf':raise ValueError('Declared native runtime differs from the locked exporter')
    import hashlib
    for name,row in settings.get('files',{}).items():
        if Path(name).name!=name or not isinstance(row,dict):raise ValueError('Unsafe declared artifact path')
        file=root/name
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=row.get('sha256') or file.stat().st_size!=row.get('bytes'):raise ValueError('Declared native artifact integrity failure')
    if 'schema.json' not in settings.get('files',{}):raise ValueError('A native declaration requires its schema artifact for contract verification')
    spec=json.loads((root/'schema.json').read_text())
    expected_entities=[{k:e[k] for k in ('label','description')} for e in spec['entities']]
    if [{k:e[k] for k in ('label','description')} for e in contract['entities']]!=expected_entities:raise ValueError('Complete ordered entity prompts differ from the source schema')
    expected_groups=[{'field':g['label'],'labels':[{'label':g['label']+': '+v['label'],'value':v['label']} for v in g['values']],'qualifyLabels':False,'selection':'single','appliesTo':[e['label'] for e in spec['entities'] if e['id'] in g['appliesTo']]} for g in spec['attributes']]
    if contract['attributes']!=expected_groups:raise ValueError('Attribute labels, ordering or applicability differ from the source schema')


def contract_from_schema(spec,settings):
    """Compile the documented entity/attribute JSON dialect, without a DTD."""
    entities=spec.get('entities');groups=spec.get('attributes')
    if not isinstance(entities,list) or not isinstance(groups,list):raise ValueError('Expected external entity/attribute schema arrays')
    contract={'format':FORMAT,'threshold':settings['threshold'],'maxEncodedTokens':settings['maxEncodedTokens'],'overlapPolicy':settings['overlapPolicy'],'contextPolicy':'reject',
        'entities':[{'family':e['label'] if ID.fullmatch(e['label']) else e['id'],'label':e['label'],'description':e['description']} for e in entities],
        'attributes':[{'field':g['label'],'labels':[{'label':g['label']+': '+v['label'],'value':v['label']} for v in g['values']],'qualifyLabels':False,'selection':g['selection'],'appliesTo':[e['label'] for e in entities if e['id'] in g['appliesTo']]} for g in groups]}
    return validate_contract(contract)
