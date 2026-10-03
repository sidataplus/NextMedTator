"""Optional external source-checkpoint qualification; requires the pinned official GLiNER2 runtime."""
import json,torch,time,sys
from pathlib import Path
from gliner2 import AutoExtractor
torch.set_num_threads(1)
import argparse
p=argparse.ArgumentParser();p.add_argument('--source',required=True);a=p.parse_args()
root=a.source
start=time.perf_counter();model=AutoExtractor.from_pretrained(root,map_location='cpu',local_files_only=True)
text='Apple CEO Tim Cook announced iPhone 15 in Cupertino yesterday.'
results=model.extract_entities(text,['company','person','product','location'],include_confidence=True,include_spans=True)
reference=json.loads(Path('tests/fixtures/gliner-small-source.json').read_text())['results'];assert results==reference,'Source checkpoint golden changed'
Path('test-results').mkdir(exist_ok=True)
Path('test-results/source-small.json').write_text(json.dumps({'sourceRevision':'7132dc4561c3f94563c6147e75ffa8ef34c4964a','sourceCodeRevision':'55656fbfa01d3d4a77485e1a1eeeaf682990ccdf','results':results,'elapsedMs':(time.perf_counter()-start)*1000},indent=2))
print(json.dumps(results,indent=2))
