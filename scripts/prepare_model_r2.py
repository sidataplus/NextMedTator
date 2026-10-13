"""Prepare verified model objects and a build catalog; never upload or create R2 resources.

Only graphs, tokenizer, complete contract, and random-latent head fixtures leave
the private qualification archive. Source notes and encoded inputs are excluded.
"""
import argparse, hashlib, json, zipfile
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(archive_path, report_path, out, origin=None):
    report=json.loads(report_path.read_text(encoding='utf-8'))
    with archive_path.open('rb') as stream:archive_hash=hashlib.file_digest(stream,'sha256').hexdigest()
    if report['packageSha256']!=archive_hash:
        raise ValueError('Export receipt does not identify this archive')
    if not report.get('onnx') or not all(r.get('spansAndAttributesExact') or r.get('status')=='unsupported' for r in report['onnx']):
        raise ValueError('Native/ONNX parity receipt required')
    if out.exists():raise ValueError('Refusing to overwrite delivery output')
    with zipfile.ZipFile(archive_path) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        if len(manifest['variants'])!=1 or manifest['variants'][0]['codec']!='gliner25-entity-attributes-v1':
            raise ValueError('Only fixed entity/attribute packages are supported')
        allowed={'model.onnx','attributes.onnx','tokenizer.json','entity-contract.json','attributes-reference.json'}
        files=[f for f in manifest['files'] if f['path'] in allowed]
        if {f['path'] for f in files}!=allowed:raise ValueError('Expected audited artifact inventory')
        fixture=json.loads(archive.read('attributes-reference.json'))
        if (fixture.get('graph')!='attributes' or fixture.get('tokenRows')!=[] or
            set(fixture.get('feeds',{}))!={'text_states','text_word_mask','query_states','query_marker_mask','span_indices'} or
            set(fixture)-{'graph','origin','tokenRows','feeds','outputs'}):raise ValueError('Head fixture includes unreviewed data')
        manifest['files']=list(files)
        manifest['id']+='-r2'
        manifest['variants'][0]['fixtures']=['attributes-reference.json']
        manifest['variants'][0]['conformanceScope']='numerical-heads-only'
        manifest['qualification']={'kind':'numerical-head-only','notice':'Download conformance checks random-latent attributes only. Source/browser parity must be qualified separately. Clinical validity is unqualified.'}
        root=Path(__file__).resolve().parents[1]
        notices={'LICENSES/Apache-2.0.txt':(root/'LICENSE').read_bytes(),
                 'LICENSES/DeBERTa-MIT.txt':(root/'licenses/model-delivery/DeBERTa-MIT.txt').read_bytes(),
                 'NOTICE.txt':manifest['license']['notice'].encode('utf-8')}
        manifest['files'].extend({'path':name,'bytes':len(payload),'sha256':sha(payload),'role':'notice'} for name,payload in notices.items())
        def integers(value):
            if isinstance(value,float) and value.is_integer():return int(value)
            if isinstance(value,list):return [integers(v) for v in value]
            if isinstance(value,dict):return {k:integers(v) for k,v in value.items()}
            return value
        manifest=integers(manifest)
        # Match the application's sorted canonical JSON fingerprint.
        data=json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
        revision=sha(data);prefix='/nextmedtator-models/'+revision+'/'
        target=out/revision;target.mkdir(parents=True)
        objects=[]
        for f in files:
            payload=archive.read(f['path'])
            if len(payload)!=f['bytes'] or sha(payload)!=f['sha256']:raise ValueError('Artifact hash mismatch')
            (target/f['path']).write_bytes(payload);objects.append(f)
        for name,payload in notices.items():
            path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
            objects.append({'path':name,'bytes':len(payload),'sha256':sha(payload)})
        (target/'manifest.json').write_bytes(data)
        plan={'manifestSha256':revision,'prefix':prefix,'objects':objects+[{'path':'manifest.json','bytes':len(data),'sha256':revision}],
              'sourcePackageSha256':report['packageSha256'],'uploadPerformed':False}
        (out/'publication-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
        if origin:
            entry={'id':manifest['id'],'revision':revision,'manifest':manifest,'delivery':{'kind':'r2','origin':origin,'prefix':prefix},
                   'urls':{f['path']:origin+prefix+f['path'] for f in manifest['files']}}
            catalog={'entries':[entry]}
            # Use the same strict build-time URL validation as the static build.
            import os
            from model_delivery import r2_catalog
            catalog_path=out/'catalog.json';catalog_path.write_text(json.dumps(catalog,indent=2),encoding='utf-8')
            previous=os.environ.get('NMT_MODEL_CATALOG');os.environ['NMT_MODEL_CATALOG']=str(catalog_path)
            try:r2_catalog()
            finally:
                if previous is None:os.environ.pop('NMT_MODEL_CATALOG',None)
                else:os.environ['NMT_MODEL_CATALOG']=previous
        return plan


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True);p.add_argument('--origin',help='Exact intended HTTPS R2 custom origin; optional until configured')
    a=p.parse_args();print(json.dumps(prepare(a.archive,a.report,a.out,a.origin),indent=2))
