"""Independent native head fixtures. Run from the repository root with pinned ORT/numpy."""
from pathlib import Path
import numpy as np,json,onnxruntime as ort
import argparse
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);a=p.parse_args()
root=a.source/'onnx';rng=np.random.default_rng(431)
shapes={
 'attrs':{'text_states':(1,512,384),'text_word_mask':(1,512),'query_states':(1,8,384),'query_marker_mask':(1,8),'span_indices':(1,8,16,2)},
 'records':{'inst_states':(1,2,384),'inst_mask':(1,2),'field_query_states':(1,2,384),'field_cand_states':(1,2,4,384),'field_cand_mask':(1,2,4)},
 'heads':{'text_states':(1,6,384),'rel_states':(1,1,768),'head_start':(1,2),'head_end':(1,2),'tail_start':(1,2),'tail_end':(1,2),'rel_index':(1,2),'pair_mask':(1,2)}}
opts=ort.SessionOptions();opts.log_severity_level=3;opts.intra_op_num_threads=1
for name,inputs in shapes.items():
 feeds={}
 for key,shape in inputs.items():
  if key=='span_indices':v=np.zeros(shape,dtype=np.int64);v[...,1]=1
  elif key in ['head_start','head_end','tail_start','tail_end','rel_index']:v=np.full(shape,{'head_start':0,'head_end':1,'tail_start':2,'tail_end':3,'rel_index':0}[key],dtype=np.int64)
  elif 'mask' in key:v=np.ones(shape,dtype=np.float32)
  else:v=rng.normal(0,.1,shape).astype(np.float32)
  feeds[key]=v
 session=ort.InferenceSession(str(root/(name+'.onnx')),opts,providers=['CPUExecutionProvider']);out=session.run(None,feeds)
 fixture={'graph':{'attrs':'attributes','heads':'relations','records':'records'}[name],'tokenRows':[],'feeds':{k:{'dims':list(v.shape),'type':'int64' if v.dtype==np.int64 else 'float32','data':v.flatten().tolist()} for k,v in feeds.items()},'outputs':{v.name:{'dims':list(data.shape),'data':data.flatten().tolist(),'tolerance':{'atol':.0001,'rtol':.0001}} for v,data in zip(session.get_outputs(),out)},'origin':'Independent onnxruntime CPU head evaluation; deterministic seed 431'}
 Path('tests/fixtures/gliner-small-'+name+'.json').write_text(json.dumps(fixture,separators=(',',':')))
 print(name,{v.name:list(data.shape) for v,data in zip(session.get_outputs(),out)})
