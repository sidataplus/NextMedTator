"""Package the compiled static site with its verified inventory, without weights."""
import hashlib, json, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def package(out):
    source=ROOT/'dist';inventory=json.loads((source/'asset-manifest.json').read_text(encoding='utf-8'))
    for row in inventory['assets']:
        file=source/row['path']
        if not file.resolve().is_relative_to(source.resolve()):raise ValueError('Invalid asset path')
        data=file.read_bytes()
        if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Static inventory mismatch')
    if any(p.suffix in ('.onnx','.safetensors') for p in source.rglob('*')):raise ValueError('Model weights must stay in R2')
    out.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_file():archive.write(file,file.relative_to(source).as_posix())
    with out.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    out.with_suffix(out.suffix+'.sha256').write_text(digest+'  '+out.name+'\n',encoding='utf-8')
    return {'file':str(out),'bytes':out.stat().st_size,'sha256':digest,'build':inventory['version']}


if __name__=='__main__':
    version=json.loads((ROOT/'package.json').read_text())['version']
    print(json.dumps(package(ROOT/'work/releases'/('NextMedTator-'+version+'-static.zip')),indent=2))
