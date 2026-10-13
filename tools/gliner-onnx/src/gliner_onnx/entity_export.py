"""Export a declared fixed entity/attribute contract with end-to-end source parity."""
import gc,hashlib,json,tempfile,time,zipfile,importlib.metadata
from pathlib import Path
import numpy as np
from .entity_contract import CODEC,read_contract,build_schema,app_schema,native_records,compare_records
from .inputs import read_adapter,resolve_base,verify_base,digest

def source_case(model,schema,text,contract):
    import torch
    batch=model.processor.collate_fn_inference([(text,schema.build())],max_len=None,error_policy='raise',architecture='boundary',build_targets=False,on_capacity_exceeded='raise')
    tokens=int(batch.attention_mask[0].sum())
    from gliner2.processing.word_splitter import WhitespaceTokenSplitter
    if tokens>contract['maxEncodedTokens'] or len(list(WhitespaceTokenSplitter()(text)))>contract.get('maxWords',contract['maxEncodedTokens']):return {'text':text,'encodedTokens':tokens,'status':'unsupported','records':[]}
    with torch.inference_mode():result=model.extract(text,schema,threshold=contract['threshold'],include_spans=True,include_confidence=True,overlap_policy=contract['overlapPolicy'])
    return {'text':text,'encodedTokens':tokens,'status':'complete','records':native_records(result,contract),'native':result}

def feeds_for(model,schema,text,words):
    import torch
    from .export import CLINICAL_INPUTS
    batch=model.processor.collate_fn_inference([(text,schema.build())],max_len=None,error_policy='raise',architecture='boundary',build_targets=False,on_capacity_exceeded='raise')
    feeds={name:getattr(batch,name) for name in CLINICAL_INPUTS}
    count=feeds['text_word_indices'].shape[1]
    if count>words:raise ValueError('Word axis exceeds encoded-token contract')
    for name in ('text_word_indices','text_word_mask'):feeds[name]=torch.nn.functional.pad(feeds[name],(0,words-count))
    return feeds,batch

def decode_onnx(outputs,attrs_session,text,contract,pair_temperature,abstention):
    from gliner2.processing.word_splitter import WhitespaceTokenSplitter
    from gliner2.inference.overlap import resolve_overlaps
    import torch
    normalized=text if text.endswith(('.', '!', '?')) else text+'.'
    words=list(WhitespaceTokenSplitter()(normalized));entities=contract['entities'];choices=sorted({(g['field']+': '+r['label']) if g['qualifyLabels'] else r['label'] for g in contract['attributes'] for r in g['labels']})
    labels=[e['label'] for e in entities]+choices;at={label:i for i,label in enumerate(labels)}
    records=[]
    for qi,entity in enumerate(entities):
        if float(torch.sigmoid(torch.tensor(outputs['null_logits'][0,qi])))>abstention:continue
        candidates=[]
        for ci,(start,end) in enumerate(outputs['pair_indices'][0,qi]):
            if not outputs['pair_valid'][0,qi,ci] or not 0<=start<end<=len(words):continue
            score=float(torch.sigmoid(torch.tensor(outputs['pair_logits'][0,qi,ci]/pair_temperature)))
            if score>=contract['threshold']:candidates.append((score,int(start),int(end)))
        selected=resolve_overlaps(candidates,contract['overlapPolicy'],score=lambda r:r[0],start=lambda r:r[1],end=lambda r:r[2])
        for score,start,end in selected:
            char_start,char_end=words[start][1],words[end-1][2];surface=text[char_start:char_end].strip()
            if not surface:continue
            records.append({'id':str(len(records)),'documentId':'pending','family':entity['family'],'anchor':[{'start':char_start,'end':char_end,'text':surface}],'fields':{},'evidence':[],'score':score,'attributeScores':{},'_words':(start,end)})
    hidden=outputs['text_states'].shape[2];word_axis=contract['maxEncodedTokens'];mask=np.zeros((1,word_axis),np.float32);mask[:,:len(words)]=1
    for group in contract['attributes']:
        applicable={e['family'] for e in entities if e['label'] in group['appliesTo']};selected=[r for r in records if r['family'] in applicable]
        q=np.zeros((1,8,hidden),np.float32);qmask=np.zeros((1,8),np.float32)
        for index,row in enumerate(group['labels']):
            label=group['field']+': '+row['label'] if group['qualifyLabels'] else row['label'];q[0,index]=outputs['query_states'][0,at[label]];qmask[0,index]=1
        for offset in range(0,len(selected),16):
            rows=selected[offset:offset+16];indices=np.zeros((1,8,16,2),np.int64)
            for c in range(16):indices[0,:,c,:]=rows[min(c,len(rows)-1)]['_words']
            logits=attrs_session.run(None,{'text_states':outputs['text_states'],'text_word_mask':mask,'query_states':q,'query_marker_mask':qmask,'span_indices':indices})[0][0]
            for c,row in enumerate(rows):
                p=torch.softmax(torch.tensor(logits[:len(group['labels']),c]/pair_temperature),dim=0);best=int(p.argmax());row['fields'][group['field']]=group['labels'][best]['value'];row['attributeScores'][group['field']]=float(p[best])
    for row in records:row.pop('_words')
    return records

def build(args):
    import torch
    runtime_revision = None
    if getattr(args,'p10_release',None):
        from .release_profiles import verify_p10,P10_RUNTIME
        verify_p10(args.p10_release)
        import sys
        vendor = (Path(args.p10_release)/'vendor').resolve()
        if 'gliner2' in sys.modules:raise ValueError('P10 requires a fresh export process')
        sys.path.insert(0,str(vendor))
        runtime_revision = P10_RUNTIME
    from gliner2 import AutoExtractor
    from . import export
    from .cli import merge_adapter,SOURCE_REVISION
    if not args.adapter or not args.base_dir:raise ValueError('Entity-contract export requires local --adapter and verified --base-dir')
    if args.out.resolve()==args.report.resolve():raise ValueError('Output and report must be distinct')
    if args.out.exists():raise ValueError('Output already exists')
    runtime=json.loads(importlib.metadata.distribution('gliner2').read_text('direct_url.json') or '{}')
    if not runtime_revision and runtime.get('vcs_info',{}).get('commit_id')!=SOURCE_REVISION:raise ValueError('Install the exact locked GLiNER2 Git runtime before export')
    runtime_revision = runtime_revision or SOURCE_REVISION
    contract=read_contract(args.entity_contract);torch.set_num_threads(args.threads)
    source=json.loads(Path(args.cases).read_text(encoding="utf-8")) if args.cases else None
    notes=source.get('notes') if isinstance(source,dict) else source
    if not isinstance(notes,list) or not 1<=len(notes)<=64 or any(not isinstance(r.get('text'),str) or not r['text'].strip() for r in notes):raise ValueError('Supply 1–64 synthetic parity notes with --cases')
    args.work_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='entity-export-',dir=args.work_dir) as scratch:
        scratch=Path(scratch);adapter=scratch/'adapter'
        # The new codec explicitly retains these settings instead of the legacy guard.
        config,adapter_hash=read_adapter(args.adapter,adapter,entity_contract=contract)
        base_model,revision=resolve_base(config,args.base_model,args.base_revision);base_hashes=verify_base(args.base_dir,base_model,revision)
        model=AutoExtractor.from_pretrained(str(args.base_dir),map_location='cpu',local_files_only=True).eval();schema=build_schema(model,contract)
        model.load_adapter(str(adapter));active=[]
        for index,note in enumerate(notes):
            row=source_case(model,schema,note['text'],contract);active.append(row);print(f'Active source {index+1}/{len(notes)}: {row["status"]}',flush=True)
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.with_name(args.report.stem+'-source.json').write_text(json.dumps({'phase':'actual-active-native-source','contract':contract,'adapterHash':adapter_hash,'base':{'model':base_model,'revision':revision},'torch':torch.__version__,'notes':active},ensure_ascii=False), encoding="utf-8")
        del schema,model;gc.collect()
        model=AutoExtractor.from_pretrained(str(args.base_dir),map_location='cpu',local_files_only=True).eval()
        model,merge=merge_adapter(model,adapter);schema=build_schema(model,contract);merged=[];merge_checks=[]
        for index,note in enumerate(notes):
            row=source_case(model,schema,note['text'],contract);merged.append(row)
            if row['status']!=active[index]['status'] or row['encodedTokens']!=active[index]['encodedTokens']:raise ValueError('Adapter merge changed capacity behavior')
            merge_checks.append(compare_records(active[index]['records'],row['records']));print(f'Merged source {index+1}/{len(notes)}: parity passed',flush=True)
        graphs=scratch/'graphs';graphs.mkdir();export.WORDS=contract['maxEncodedTokens'];model.processor.tokenizer.save_pretrained(str(graphs));(graphs/'entity-contract.json').write_text(json.dumps(contract,ensure_ascii=False), encoding="utf-8")
        first=next(r for r in merged if r['status']=='complete');feeds,_=feeds_for(model,schema,first['text'],export.WORDS)
        wrapper=export.ClinicalMain(model).eval()
        with torch.no_grad():reference=dict(zip(export.CLINICAL_OUTPUTS,wrapper(*feeds.values())));head_reference=export.Attributes(model)(*export.head_feeds(model.hidden_size)['attributes'].values())
        export.prepare_web_attention(model)
        dynamic={name:{1:'tokens' if name in ['input_ids','attention_mask'] else 'queries'} for name in export.CLINICAL_INPUTS if name not in ['text_word_indices','text_word_mask']}
        dynamic.update({name:{1:'queries'} for name in export.CLINICAL_OUTPUTS if name!='text_states'})
        _,main_errors=export.export_graph(wrapper,feeds,export.CLINICAL_OUTPUTS,graphs/'model.onnx',dynamic,source_reference=reference);del reference;gc.collect()
        head_report=export.export_heads(model,graphs,head_reference,clinical=True);del head_reference;gc.collect()
        main,attrs=export.session(graphs/'model.onnx'),export.session(graphs/'attributes.onnx');checks=[];fixture_names=[];fixture_budget=0
        for index,(note,expected) in enumerate(zip(notes,merged)):
            if expected['status']=='unsupported':checks.append({'case':index,'status':'unsupported','encodedTokens':expected['encodedTokens']});continue
            feeds,batch=feeds_for(model,schema,note['text'],export.WORDS);values=dict(zip(export.CLINICAL_OUTPUTS,main.run(None,{k:v.numpy() for k,v in feeds.items()})))
            decoded=decode_onnx(values,attrs,note['text'],contract,model.boundary_settings.pair_temperature,model.boundary_settings.abstention_threshold);check=compare_records(expected['records'],decoded);checks.append({'case':index,'encodedTokens':expected['encodedTokens'],**check});print(f'ONNX {index+1}/{len(notes)}: parity passed',flush=True)
            # A small model-package fixture set; full corpus receipts remain private.
            if fixture_budget<3 and (index==0 or decoded or not expected['records']):
                source_case_path=f'source-case-{fixture_budget}.json';raw_path=f'model-reference-{fixture_budget}.json'
                (graphs/source_case_path).write_text(json.dumps({'text':note['text'],'schema':app_schema(contract),'records':expected['records'],'encodedTokens':expected['encodedTokens'],'threshold':contract['threshold'],'origin':'Actual merged native synthetic reference; no clinical validation'},ensure_ascii=False,separators=(',',':')), encoding="utf-8")
                with torch.no_grad():native=dict(zip(export.CLINICAL_OUTPUTS,wrapper(*feeds.values())))
                numeric=export.compare(native,values)
                raw=export.fixture('model',feeds,{k:native[k] for k in ['pair_indices','pair_logits','pair_valid','null_logits']});raw['candidateComparison']='span-keyed-v1'
                raw['packedInputExact']=True;raw['sourceText']=note['text']
                (graphs/raw_path).write_text(json.dumps(raw,separators=(',',':')), encoding="utf-8");fixture_names.extend([source_case_path,raw_path]);fixture_budget+=1
        fixture_names.extend(sorted(p.name for p in graphs.glob('*-reference.json')));fixture_names=list(dict.fromkeys(fixture_names))
        files=[]
        names=['model.onnx','attributes.onnx','tokenizer.json','entity-contract.json',*fixture_names]
        for name in names:
            p=graphs/name;files.append({'path':name,'bytes':p.stat().st_size,'sha256':digest(p),'role':'graph' if name.endswith('.onnx') else 'tokenizer' if name=='tokenizer.json' else 'schema' if name=='entity-contract.json' else 'fixture'})
        contract_hash=digest(graphs/'entity-contract.json');package_id=args.id or 'gliner25-entities-'+adapter_hash[:12]
        manifest={'format':'nextmedtator-model-v1','id':package_id,'version':adapter_hash,'runtime':'onnxruntime-web','runtimeVersion':'1.23.2','license':{'id':args.adapter_license,'notice':'Base '+base_model+': '+args.base_license+'. Adapter: '+args.adapter_license+'. Local export implies no redistribution permission. Clinical accuracy is unqualified.'},'lineage':{'base':{'model':base_model,'revision':revision,'files':base_hashes},'adapter':{'sha256':adapter_hash,'baseRevision':revision,'weightsSha256':digest(adapter/'adapter_model.safetensors'),'configSha256':digest(adapter/'adapter_config.json'),**({'repository':args.adapter_repository,'revision':args.adapter_revision} if args.adapter_repository else {})},'merge':'merged-export','trainedHeads':merge['trainedHeads'],'runtime':{'upstreamCommit':runtime_revision}},'files':files,'capabilities':['*'],'variants':[{'id':'wasm-fp32','backend':'wasm','precision':'fp32','codec':CODEC,'graph':'model.onnx','graphs':{'model':'model.onnx','attributes':'attributes.onnx'},'tokenizer':'tokenizer.json','fixtures':fixture_names,'entityContract':'entity-contract.json','entityContractSha256':contract_hash,'threshold':contract['threshold'],'fixedThreshold':True,'mainMaskType':'bool','fixedWords':export.WORDS,'maxSequenceLength':contract['maxEncodedTokens'],'pairTemperature':model.boundary_settings.pair_temperature,'abstentionThreshold':model.boundary_settings.abstention_threshold,'automaticRelations':False,'recordBinding':False}]}
        args.out.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix='entity-package-',suffix='.zip',dir=args.out.parent,delete=False) as temp:temporary=Path(temp.name)
        try:
            with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('manifest.json',json.dumps(manifest))
                for name in names:archive.write(graphs/name,name)
            with zipfile.ZipFile(temporary) as archive:
                if archive.testzip() is not None:raise ValueError('Exported package failed archive verification')
            temporary.replace(args.out)
        finally:temporary.unlink(missing_ok=True)
        report={'packageId':package_id,'packageBytes':args.out.stat().st_size,'packageSha256':digest(args.out),'contractSha256':contract_hash,'sourceNativeToMergedNative':merge_checks,'onnx':checks,'mainExportErrors':main_errors,'headExport':head_report,'merge':merge,'native':merged,'contract':contract,'browserInferenceQualified':False,'clinicalValidation':False,'torch':torch.__version__,'base':manifest['lineage']['base'],'adapter':manifest['lineage']['adapter']}
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding="utf-8");return report
