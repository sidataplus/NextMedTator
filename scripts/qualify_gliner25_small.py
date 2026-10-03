"""Independent native ONNX golden inputs and output scores using the published tokenizer.

Use with uv run --with onnxruntime --with tokenizers --with numpy. Outputs are synthetic/public fixtures.
"""
import argparse,json,time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 fixture=json.loads(Path('tests/fixtures/gliner-small-card.json').read_text());text=fixture['text'];labels=list(fixture['schema']['families'])
 # Frozen source-model-card words, independently specified rather than imported from JS.
 words=['apple','ceo','tim','cook','announced','iphone','15','in','cupertino','yesterday','.']
 schema=['(','[P]','entities','(']+sum((['[E]',label] for label in labels),[])+[')',')']
 tokenizer=Tokenizer.from_file(str(a.source/'tokenizer.json'));combined=schema+['[SEP_TEXT]']+words;ids=[];q=[];w=[];tokenRows=[]
 for i,token in enumerate(combined):
  encoded=tokenizer.encode(token,add_special_tokens=False).ids
  if i<len(schema) and token=='[E]':q.append(len(ids))
  if i>len(schema):w.append(len(ids))
  tokenRows.append({'text':token,'ids':encoded});ids+=encoded
 feeds={'input_ids':np.array([ids],dtype=np.int64),'attention_mask':np.ones((1,len(ids)),dtype=np.int64),'text_word_indices':np.array([w],dtype=np.int64),'text_word_mask':np.ones((1,len(w)),dtype=np.float32),'query_marker_indices':np.array([q],dtype=np.int64),'query_marker_mask':np.ones((1,len(q)),dtype=np.float32),'cls_marker_indices':np.array([[0]],dtype=np.int64),'cls_marker_mask':np.zeros((1,1),dtype=np.float32),'rel_marker_indices':np.array([[0]],dtype=np.int64),'rel_marker_mask':np.zeros((1,1),dtype=np.float32)}
 opts=ort.SessionOptions();opts.log_severity_level=3;opts.intra_op_num_threads=1
 start=time.perf_counter();session=ort.InferenceSession(str(a.source/'onnx/model.onnx'),opts,providers=['CPUExecutionProvider']);cold=time.perf_counter()-start
 durations=[]
 for _ in range(6):
  start=time.perf_counter();outputs=dict(zip([v.name for v in session.get_outputs()],session.run(None,feeds)));durations.append((time.perf_counter()-start)*1000)
 offset=[(0,5),(6,9),(10,13),(14,18),(19,28),(29,35),(36,38),(39,41),(42,51),(52,61),(61,62)];spans=[]
 for qi,label in enumerate(labels):
  seen=set()
  for ci,(s,e) in enumerate(outputs['pair_indices'][0,qi]):
   score=float(1/(1+np.exp(-outputs['pair_logits'][0,qi,ci])))
   if score<.5 or s>=e or s<0 or e>len(words) or (int(s),int(e)) in seen:continue
   seen.add((int(s),int(e)));start,end=offset[int(s)][0],offset[int(e)-1][1];spans.append({'label':label,'start':start,'end':end,'text':text[start:end],'score':score})
 source=json.loads(Path('tests/fixtures/gliner-small-source.json').read_text());source_spans={(label,r['start'],r['end']):r['confidence'] for label,rows in source['results']['entities'].items() for r in rows}
 for span in spans:assert abs(span['score']-source_spans[(span['label'],span['start'],span['end'])])<=.0001,'Native/source score mismatch'
 # The card's nonoverlapping retained spans must equal the source-model golden exactly.
 expected=sorted([(r['family'],r['anchor'][0]['start'],r['anchor'][0]['end']) for r in fixture['records']]);got=sorted([(r['label'],r['start'],r['end']) for r in spans]);assert got==expected,(got,expected)
 result={'revision':'5e2e3f51adfb0eeb7c1f83464400b4d498d41659','nativeRuntime':ort.__version__,'tokenRows':tokenRows,'feeds':{k:{'dims':list(v.shape),'type':'int64' if v.dtype==np.int64 else 'float32','data':v.flatten().tolist()} for k,v in feeds.items()},'outputs':{k:{'dims':list(outputs[k].shape),'data':outputs[k].flatten().tolist(),'tolerance':{'atol':0.0001,'rtol':0.0001}} for k in ['pair_logits']},'spans':spans,'coldLoadMs':cold*1000,'warmInferenceMs':durations,'nativeSourceGoldenExact':True}
 a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2));print(json.dumps({k:result[k] for k in ['revision','coldLoadMs','warmInferenceMs','nativeSourceGoldenExact']}))
if __name__=='__main__':main()
