"""Create the static build catalog for already prepared immutable R2 objects."""
import argparse, hashlib, json, os
from pathlib import Path
from model_delivery import r2_catalog


def catalog(prepared, origin, out):
    entries=[]
    for root in prepared:
        plan=json.loads((root/'publication-plan.json').read_text(encoding='utf-8'))
        revision=plan['manifestSha256'];payload=root/revision
        for row in plan['objects']:
            path=payload/row['path']
            if not path.resolve().is_relative_to(payload.resolve()):raise ValueError('Object outside prepared directory')
            with path.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
            if path.stat().st_size!=row['bytes'] or actual!=row['sha256']:raise ValueError('Prepared object changed')
        manifest=json.loads((payload/'manifest.json').read_text(encoding='utf-8'))
        entries.append({'revision':revision,'manifest':manifest,'delivery':{'kind':'r2','origin':origin,'prefix':plan['prefix']},
                        'urls':{f['path']:origin+plan['prefix']+f['path'] for f in manifest['files']}})
    data={'entries':entries}
    with out.open('x',encoding='utf-8') as stream:json.dump(data,stream,indent=2)
    old=os.environ.get('NMT_MODEL_CATALOG');os.environ['NMT_MODEL_CATALOG']=str(out)
    try:r2_catalog()
    finally:
        if old is None:os.environ.pop('NMT_MODEL_CATALOG',None)
        else:os.environ['NMT_MODEL_CATALOG']=old
    return data


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--prepared',type=Path,nargs='+',required=True)
    p.add_argument('--origin',required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();catalog(a.prepared,a.origin,a.out);print('Verified catalog written; no model uploaded or access changed.')
