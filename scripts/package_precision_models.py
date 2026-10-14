"""Package browser-qualified precision candidates; only public synthetic fixtures.

Reads immutable public exports and browser benchmark receipts. Writes new
immutable R2 publication plans and app catalog entries; never uploads.
"""
import argparse, copy, hashlib, json, shutil, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--archives',action='store_true');args=parser.parse_args()
    catalog_path=ROOT/'deployment/production-model-catalog.json'
    original=json.loads(catalog_path.read_text())['entries'][:2]
    entries=copy.deepcopy(original)
    for index,profile in enumerate(['p10','bpsd']):
        base=original[index]
        source=ROOT/'work'/('final-r2-'+profile)/base['revision']
        native=json.loads((ROOT/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))['native']
        for precision in ['fp16']:
            receipts=json.loads((ROOT/'temp/browser-validation/webgpu'/(profile+'-'+precision+'.json')).read_text())
            run=receipts['runs'][0]
            assert not run.get('error') and run['conformance']['pass']
            metadata=json.loads((ROOT/'work/precision'/profile/(precision+'.json')).read_text())
            assert digest(ROOT/'work/precision'/profile/('model-'+precision+'.onnx'))==metadata['sha256']
            if 'modelSha256' in receipts:assert receipts['modelSha256']==metadata['sha256']
            cases=run['cases'][:len(native)]
            assert len(cases)==len(native)
            assert all(case['labels']['pass'] for case in run['cases'])
            manifest=copy.deepcopy(base['manifest']);manifest['id']=profile+'-'+precision+'-r2'
            variant=manifest['variants'][0]
            variant.update(id='webgpu-'+precision,backend='webgpu',precision=precision,
                           conformanceScope='synthetic-precision-v1')
            manifest['lineage']['precisionConversion']={
                'sourceManifestHash':base['revision'],'tool':'onnxruntime 1.23.2',
                'method':'float16-keep-io-fp32','attributesPrecision':'fp32','experimental':False}
            staging=ROOT/'work/precision'/profile/('package-'+precision);staging.mkdir(exist_ok=True)
            for file in manifest['files']:
                target=staging/file['path'];target.parent.mkdir(parents=True,exist_ok=True)
                src=ROOT/'work/precision'/profile/('model-'+precision+'.onnx') if file['path']=='model.onnx' else source/file['path']
                shutil.copyfile(src,target)
                file.update(bytes=target.stat().st_size,sha256=digest(target))
            # The candidate's own output fixtures verify runtime reproducibility.
            # FP32 agreement is reported separately, never implied by these fixtures.
            for index2,(note,case) in enumerate(zip(native,cases)):
                name=f'synthetic-{index2}.json'
                fixture={'source':'Synthetic browser precision qualification; not an FP32 equivalence assertion',
                         'text':note['text'],'schema':note.get('schema'),
                         'records':case['records'],'encodedTokens':note['encodedTokens']}
                for record_index,record in enumerate(fixture['records']):record['id']=f'synthetic-{index2}-{record_index}'
                if fixture['schema'] is None:
                    # Native export carries the public contract; build the exact
                    # schema once in the browser benchmark and retain it there.
                    fixture['schema']=receipts['schema']
                data=canonical(fixture);(staging/name).write_bytes(data)
                manifest['files'].append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'role':'fixture'})
                variant['fixtures'].append(name)
            revision=hashlib.sha256(canonical(manifest)).hexdigest()
            out=ROOT/'work'/('precision-r2-'+profile+'-'+precision);folder=out/revision
            folder.mkdir(parents=True,exist_ok=True)
            for file in manifest['files']:
                target=folder/file['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(staging/file['path'],target)
            (folder/'manifest.json').write_bytes(canonical(manifest))
            prefix='/nextmedtator-models/'+revision+'/'
            (out/'publication-plan.json').write_text(json.dumps({'manifestSha256':revision,'prefix':prefix,'objects':manifest['files']},indent=2)+'\n')
            origin=base['delivery']['origin']
            entries.append({'revision':revision,'manifest':manifest,'delivery':{'kind':'r2','origin':origin,'prefix':prefix},'urls':{f['path']:origin+prefix+f['path'] for f in manifest['files']}})
            if args.archives:
                with zipfile.ZipFile(ROOT/'work'/f'{profile}-{precision}.nmt-model.zip','w',zipfile.ZIP_DEFLATED,compresslevel=1) as archive:
                    archive.writestr('manifest.json',canonical(manifest))
                    for file in manifest['files']:archive.write(folder/file['path'],file['path'])
            print(profile,precision,revision,sum(f['bytes'] for f in manifest['files']),flush=True)
    catalog_path.write_text(json.dumps({'entries':entries},indent=2)+'\n')

if __name__=='__main__':main()
