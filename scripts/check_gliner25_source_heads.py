"""External official-source qualification; no training or model conversion."""
import json,torch
from pathlib import Path
from gliner2 import AutoExtractor
import argparse
p=argparse.ArgumentParser();p.add_argument('--source',required=True);a=p.parse_args()
torch.set_num_threads(1);m=AutoExtractor.from_pretrained(a.source,map_location='cpu',local_files_only=True)
text='Tim Cook leads Apple in Cupertino. Sundar Pichai runs Google in Mountain View.'
types={'leads':{'head':['person'],'tail':['organization']},'located_in':{'head':['organization'],'tail':['location']}}
rel=m.extract_relations(text,types,include_confidence=True,include_spans=True)
record=m.extract_json('The new MacBook Pro costs $1999 and has a stunning Liquid Retina display.',{'product':['name::str','price::str','features::str']},include_confidence=True,include_spans=True)
assert {'relations':rel,'records':record}==json.loads(Path('tests/fixtures/gliner-small-source-heads.json').read_text()),'Source head golden changed'
Path('test-results').mkdir(exist_ok=True)
Path('test-results/source-heads.json').write_text(json.dumps({'relations':rel,'records':record},indent=2));print(json.dumps({'relations':rel,'records':record},indent=2))
