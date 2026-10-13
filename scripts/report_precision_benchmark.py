"""Summarize real-browser precision measurements without treating speed as accuracy."""
import json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/nextmedtator/validation/precision-2026-10-13.json'
def key(record):return json.dumps([record['family'],record['anchor']],sort_keys=True)
def agreement(reference,actual):
    left={key(r):r for r in reference};right={key(r):r for r in actual}
    common=left.keys()&right.keys();errors=[]
    for identity in common:
        a=left[identity];b=right[identity];errors.append(abs(a['score']-b['score']))
        errors.extend(abs(value-b.get('attributeScores',{}).get(field,0)) for field,value in a.get('attributeScores',{}).items())
    return {'spansExact':left.keys()==right.keys(),'attributesExact':left.keys()==right.keys() and all(left[k]['fields']==right[k]['fields'] for k in common),
            'expectedRecords':len(left),'actualRecords':len(right),'maxMatchedConfidenceDifference':max(errors,default=0)}
def main():
    report={'date':'2026-10-13','method':'Four synthetic notes per model, three passes per backend. Warm timings use passes 2 and 3. No concurrent inference workloads.',
            'hardware':'Intel Xeon Silver 4210R, NVIDIA RTX A4000, Windows; WASM four threads',
            'scope':'Functional regression only, not a clinical accuracy evaluation. INT8 is experimental and never automatic fallback.', 'models':{}}
    catalog=json.loads((ROOT/'deployment/production-model-catalog.json').read_text())['entries']
    for profile in ['p10','bpsd']:
        path=ROOT/'temp/browser-validation/webgpu'
        data={precision:json.loads((path/(profile+('' if precision=='fp32' else '-'+precision)+'.json')).read_text()) for precision in ['fp32','fp16','int8']}
        baseline=next(run for run in data['fp32']['runs'] if run['backend']=='wasm')['cases'][:4]
        notes=json.loads((ROOT/'work'/(profile+'-export.json')).read_text(encoding='utf-8'))['native']
        model={'notes':[note['text'] for note in notes],'browser':data['fp16']['browser'],'gpu':data['fp16']['gpu'],'variants':[]}
        for precision,receipt in data.items():
            entry=next(e for e in catalog if (e['manifest']['id'].startswith(profile+'-') if precision!='fp32' else e==catalog[0 if profile=='p10' else 1]) and e['manifest']['variants'][0]['precision']==precision)
            for run in receipt['runs']:
                rows=[agreement(baseline[i]['records'],run['cases'][i]['records']) for i in range(4)]
                item={'precision':precision,'backend':run['backend'],'packageBytes':sum(f['bytes'] for f in entry['manifest']['files']),
                      'manifestHash':entry['revision'],'loadMs':run['loadMs'],
                      'warmMedianMs':[statistics.median(c['durationMs'] for c in run['cases'] if c['repeat']>0 and c['index']==i) for i in range(4)],
                      'outputVsFP32Wasm':rows,'measurements':run}
                model['variants'].append(item)
                print(profile,precision,run['backend'],round(item['packageBytes']/1048576,1),[round(t) for t in item['warmMedianMs']],rows,flush=True)
        report['models'][profile]=model
    OUT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
