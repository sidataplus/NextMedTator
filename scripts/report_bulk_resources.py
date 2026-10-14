"""Summarize real Windows/Chrome process measurements without hiding raw phases."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'temp/browser-validation/bulk-100';OUT=ROOT/'docs/nextmedtator/validation'
reports=[]
asset_version=None
for profile in ['p10','bpsd']:
    baseline=None;corpus_hash=None
    for mode in ['low','balanced','gpu']:
        data=json.loads((SOURCE/f'{profile}-{mode}.json').read_text(encoding='utf-8'))
        completion_report=json.loads((SOURCE/f'{profile}-{mode}-completion-report.json').read_text(encoding='utf-8'))
        assert data['notes']==100 and not data['measurementErrors'] and data['workerReleasedAfterBoth']
        assert all(b['cpuSeconds']>=a['cpuSeconds'] for a,b in zip(data['samples'],data['samples'][1:])), 'CPU counter regressed'
        if asset_version:assert data['assetVersion']==asset_version
        asset_version=data['assetVersion']
        if corpus_hash:assert data['corpusSha256']==corpus_hash
        corpus_hash=data['corpusSha256']
        semantic=lambda r:json.dumps([r['family'],r['anchor'],r['fields']],sort_keys=True,ensure_ascii=False)
        rows={r['filename']:r for r in data['outputs']}
        differences=[];max_score=0
        if baseline:
            assert rows.keys()==baseline.keys()
            for name,row in rows.items():
                before={semantic(r):r for r in baseline[name]['records']};after={semantic(r):r for r in row['records']}
                if before.keys()!=after.keys() or len(row['records'])!=len(baseline[name]['records']):differences.append(name)
                for key in before.keys()&after.keys():
                    max_score=max(max_score,abs(before[key]['score']-after[key]['score']),*(abs(before[key].get('attributeScores',{}).get(f,0)-v) for f,v in after[key].get('attributeScores',{}).items()))
        else:baseline=rows
        after=data['afterCompletion']['30'];cancel_after=data['afterCancellation']['30']
        entry={k:v for k,v in data.items() if k not in ['samples','outputs']}
        entry['peakWorkingSetEntireSessionMiB']=max(s['workingSetBytes'] for s in data['samples'])/2**20
        entry['peakPrivateEntireSessionMiB']=max(s['privateBytes'] for s in data['samples'])/2**20
        intervals=[b['t']-a['t'] for a,b in zip(data['samples'],data['samples'][1:])]
        entry['actualSamplingIntervalSeconds']={'mean':sum(intervals)/len(intervals),'max':max(intervals)}
        entry['model']=completion_report['model'];entry['settings']=completion_report['settings']
        entry['workingSetAboveLoadedBaseline30sMiB']=(after['workingSetBytes']-data['modelReady']['workingSetBytes'])/2**20
        entry['privateAboveLoadedBaseline30sMiB']=(after['privateBytes']-data['modelReady']['privateBytes'])/2**20
        entry.update({'spanOrAttributeDifferencesAgainstLowCpu':differences,'maxMatchedConfidenceDifference':max_score,'predictionCount':sum(len(r['records']) for r in rows.values()),'peakWorkingSetIncludingImportMiB':max(data['import']['peakWorkingSetMiB'],data['completion']['peakWorkingSetMiB']),'workingSetAfterCompletion30sMiB':after['workingSetBytes']/2**20,'privateAfterCompletion30sMiB':after['privateBytes']/2**20,'workingSetAfterCancellation30sMiB':cancel_after['workingSetBytes']/2**20,'privateAfterCancellation30sMiB':cancel_after['privateBytes']/2**20,'workingSetDropAfterCompletionMiB':data['completion']['peakWorkingSetMiB']-after['workingSetBytes']/2**20,'workingSetDropAfterCancellationMiB':data['cancellation']['peakWorkingSetMiB']-cancel_after['workingSetBytes']/2**20})
        reports.append(entry)
report={'date':'2026-10-13','method':{'notesPerModel':100,'templatesPerModel':4,'uniqueSyntheticCaseIds':True,'freshChromePerMode':True,'precision':'original FP32 for all modes','intervalSeconds':.25,'cpu':'Windows GetProcessTimes, summed Chrome process tree; one fully occupied logical processor = 100% core CPU. Machine CPU divides by 20 logical processors.','ram':'Windows GetProcessMemoryInfo. Working set is resident memory including shared pages (may be counted in multiple processes). Private bytes are committed memory, not resident RAM. GPU VRAM is excluded.','postRunSeconds':[0,5,15,30],'forcedGarbageCollection':False,'recoveryDuringBenchmark':False,'singlePass':True,'cancellation':'Second 100-note job in the same browser; stop after at least 10 completed notes. Retain the initial corpus/model and all completed prediction history.','rawResults':'temp/browser-validation/bulk-100','sources':['https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex','https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes']},'results':reports}
report['hardware']={'cpu':'Intel Xeon Silver 4210R @ 2.40GHz','logicalProcessors':20,'installedRamBytes':68349784064}
report['timezone']='America/New_York'
report['corpora']={}
for profile in ['p10','bpsd']:
    notes=json.loads((ROOT/'tests/fixtures'/f'bulk-100-{profile}.json').read_text(encoding='utf-8'))
    sizes=[len(n['text']) for n in notes];words=[len(n['text'].split()) for n in notes]
    report['corpora'][profile]={'characters':{'min':min(sizes),'max':max(sizes),'mean':sum(sizes)/len(sizes)},'whitespaceWords':{'min':min(words),'max':max(words),'mean':sum(words)/len(words)}}
report['method']['samplingLimit']='Processes that exit before their first sample can be missed. Observed snapshot/open races are recorded as transientProcessExits; their short-lived CPU usage is unknown. Sampled memory peaks are lower bounds.'
OUT.mkdir(parents=True,exist_ok=True);(OUT/'bulk-100-resources-2026-10-13.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
for row in reports:
    c=row['completion'];print(f"{row['profile']:4} {row['mode']:8} {c['wallSeconds']:7.1f}s CPU {c['cpuSeconds']:7.1f}s ({c['averageCpuCorePercent']:5.1f}% core), peak WS {c['peakWorkingSetMiB']:7.1f} MiB, after {row['workingSetAfterCompletion30sMiB']:7.1f} MiB, cancel after {row['workingSetAfterCancellation30sMiB']:7.1f} MiB, output differences {len(row['spanOrAttributeDifferencesAgainstLowCpu'])}")
