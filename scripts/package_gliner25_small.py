"""Package the pinned public small ONNX export; never train, merge or export weights."""
import argparse, hashlib, json, zipfile
from pathlib import Path
REPO='nicolasembleton/gliner2.5-small-v1-onnx'
REVISION='5e2e3f51adfb0eeb7c1f83464400b4d498d41659'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--catalog',type=Path);args=parser.parse_args()
    members={name:args.source/path for name,path in [('model.onnx','onnx/model.onnx'),('attributes.onnx','onnx/attrs.onnx'),('records.onnx','onnx/records.onnx'),('relations.onnx','onnx/heads.onnx'),('tokenizer.json','tokenizer.json')]}
    fixture=json.loads(Path('tests/fixtures/gliner-small-card.json').read_text());payload={name:path.read_bytes() for name,path in members.items()};payload['reference.json']=json.dumps(fixture,separators=(',',':')).encode();payload['binding-reference.json']=Path('tests/fixtures/gliner-small-binding.json').read_bytes();payload['native-reference.json']=Path('tests/fixtures/gliner-small-native.json').read_bytes();
    for head in ['attrs','records','heads']:payload[head+'-reference.json']=Path('tests/fixtures/gliner-small-'+head+'.json').read_bytes()
    manifest={'format':'nextmedtator-model-v1','id':'gliner25-small-onnx-v5','version':REVISION,'runtime':'onnxruntime-web','runtimeVersion':'1.23.2','lineage':{'base':{'model':'fastino/gliner2.5-small-v1','revision':'7132dc4561c3f94563c6147e75ffa8ef34c4964a','exportRevision':REVISION,'exportRepository':REPO,'sourceRevisionVerification':'qualification-report'}},'license':{'id':'Apache-2.0','notice':'Fastino GLiNER2.5-small; ONNX export by Pastel-Cloud OÜ. Anchored record support only. No Clinical-Evidence LoRA.'},'files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'role':'graph' if name.endswith('.onnx') else 'tokenizer' if name=='tokenizer.json' else 'fixture'} for name,data in payload.items()],'variants':[{'id':'wasm-fp32','backend':'wasm','precision':'fp32','codec':'gliner25-small-records-v5','graph':'model.onnx','graphs':{'model':'model.onnx','attributes':'attributes.onnx','records':'records.onnx','relations':'relations.onnx'},'tokenizer':'tokenizer.json','fixtures':['reference.json','binding-reference.json','native-reference.json','attrs-reference.json','records-reference.json','heads-reference.json'],'threshold':.5,'pairTemperature':1.0,'automaticRelations':False,'maxSequenceLength':512,'wordOverlap':32,'languageClaims':['en'],'schemaCompiler':'gliner25-schema-v1','wordSplitter':'gliner25-unicode-v1','decoderRevision':'nextmedtator-small-v5','sourceCodeRevision':'55656fbfa01d3d4a77485e1a1eeeaf682990ccdf'}],'capabilities':['*']}
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.out,'w',compression=zipfile.ZIP_STORED) as z:
        z.writestr('manifest.json',json.dumps(manifest,separators=(',',':')))
        for name,data in payload.items():z.writestr(name,data)
    if args.catalog:
        args.catalog.parent.mkdir(parents=True,exist_ok=True);reference=args.catalog.parent/'reference.json';reference.write_bytes(payload['reference.json']);(args.catalog.parent/'binding-reference.json').write_bytes(payload['binding-reference.json']);(args.catalog.parent/'native-reference.json').write_bytes(payload['native-reference.json']);
        for head in ['attrs','records','heads']:(args.catalog.parent/(head+'-reference.json')).write_bytes(payload[head+'-reference.json'])
        urls={name:f'https://huggingface.co/{REPO}/resolve/{REVISION}/{members[name].relative_to(args.source).as_posix()}' if name in members else './models/'+name for name in payload}
        args.catalog.write_text(json.dumps({'entries':[{'revision':REVISION,'manifest':manifest,'urls':urls}]},indent=2))
    print(json.dumps({'package':str(args.out),'bytes':args.out.stat().st_size,'revision':REVISION}))
if __name__=='__main__':main()
