"""100-note real-browser CPU/RAM benchmark with completion and cancellation.

Windows only. Serve dist on 4299. Uses original local FP32 packages, no mocks.
Every mode gets a fresh Chrome process. CPU includes all Chrome descendants.
"""
import argparse,json,time,hashlib,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_support import chromium_path
from windows_process_meter import ProcessMeter

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'temp/browser-validation/bulk-100';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--profile',choices=['p10','bpsd']);parser.add_argument('--mode',choices=['low','balanced','gpu']);args=parser.parse_args()
URL='http://127.0.0.1:4299/'
STATE="""()=>{const a=document.querySelector('nextmedtator-assist').assist;return {busy:a.busy,error:a.error,message:a.message,workerReleased:!a.modelRunner.worker&&!a.modelRunner.active,queue:a.batchQueue,rows:[...a.runs.values()].map(r=>({filename:r.filename,backend:r.backend,precision:r.precision,threads:r.runtime.wasmThreads,records:r.records.map(({family,anchor,fields,score,attributeScores})=>({family,anchor,fields,score,attributeScores}))}))};}"""

def settle(page,meter,seconds=30):
    snapshots={};start=time.perf_counter()
    for target in [0,5,15,seconds]:
        while time.perf_counter()-start<target:page.wait_for_timeout(250)
        snapshots[str(target)]=meter.mark()
    return snapshots

with sync_playwright() as p:
    for profile in ([args.profile] if args.profile else ['p10','bpsd']):
        notes=json.loads((ROOT/'tests/fixtures'/f'bulk-100-{profile}.json').read_text(encoding='utf-8'))
        corpus=json.dumps(notes,ensure_ascii=False,sort_keys=True).encode('utf-8');(OUT/f'{profile}-corpus.json').write_bytes(corpus)
        for mode in ([args.mode] if args.mode else ['low','balanced','gpu']):
            browser=p.chromium.launch(executable_path=chromium_path(),headless=True)
            cdp=browser.new_browser_cdp_session();info=cdp.send('SystemInfo.getProcessInfo')['processInfo'];pid=next(row['id'] for row in info if row['type']=='browser')
            gpu_devices=cdp.send('SystemInfo.getInfo')['gpu']['devices']
            meter=ProcessMeter(pid);context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,service_workers='block')
            page=context.new_page();page.set_default_timeout(900000);expect.set_options(timeout=900000)
            errors=[];network=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:network.append(r.url));page.on('dialog',lambda d:d.accept());page.add_init_script('globalThis.NMT_AUTO_CONFIRM=true');page.evaluate('globalThis.NMT_AUTO_CONFIRM=true')
            try:
                page.goto(URL);expect(page.locator('#start-screen')).to_be_hidden();page.get_by_test_id('assist-practice-'+profile).click()
                page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
                page.evaluate("notes=>{const v=app_hotpot.vpp;v.$data.anns=[];for(const n of notes){const a=v.add_sample_txt_as_ann(n.text);a._filename=n.filename;}v.set_ann_idx(0);}",notes)
                page.wait_for_timeout(1000);before_import=meter.mark()
                page.get_by_label('Import model package into the annotation assistance panel').set_input_files(str(ROOT/'work'/f'{profile}.nmt-model.zip'))
                page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
                page.wait_for_timeout(10000);model_ready=meter.mark()
                page.get_by_text('Batch Analysis (0 selected)',exact=True).click();page.get_by_test_id('assist-select-all').click()
                page.get_by_test_id('assist-batch-cpu').select_option('balanced' if mode=='balanced' else 'low')
                page.get_by_test_id('assist-execution').select_option('auto' if mode=='gpu' else 'wasm')
                start=meter.mark();page.get_by_test_id('assist-analyze-selected').click();last=-1;deadline=time.monotonic()+1800
                while True:
                    page.wait_for_timeout(500)
                    status=page.evaluate("()=>{const a=document.querySelector('nextmedtator-assist').assist;return {busy:a.busy,done:a.batchQueue?.notes.filter(n=>n.status==='completed').length??0};}")
                    bucket=status['done']//10
                    if bucket!=last:print(f'{profile} {mode}: {status["done"]}/100',flush=True);last=bucket
                    if not status['busy']:break
                    assert time.monotonic()<deadline,'Completion timeout'
                end=meter.mark();complete=page.evaluate(STATE)
                assert not complete['error'],complete['message']
                assert complete['workerReleased'] and len(complete['queue']['notes'])==100
                assert all(n['status']=='completed' for n in complete['queue']['notes']),complete['queue']
                assert len(complete['rows'])==100
                assert all(r['backend']==('webgpu' if mode=='gpu' else 'wasm') and r['threads']==(4 if mode=='balanced' else 1) for r in complete['rows'])
                post_complete=settle(page,meter)
                page.screenshot(path=str(OUT/f'{profile}-{mode}-completed.png'))
                with page.expect_download() as download:page.get_by_test_id('assist-batch-report').click()
                download.value.save_as(str(OUT/f'{profile}-{mode}-completion-report.json'))
                # Start another 100-note job with the same loaded model; stop after
                # ten completed notes, while the next one is running.
                cancel_start=meter.mark();page.get_by_test_id('assist-analyze-selected').click()
                page.wait_for_function("()=>document.querySelector('nextmedtator-assist').assist.batchQueue?.notes.filter(n=>n.status==='completed').length>=10",timeout=900000)
                page.get_by_test_id('assist-pause').click();page.wait_for_function("()=>!document.querySelector('nextmedtator-assist').assist.busy")
                cancel_end=meter.mark();cancelled=page.evaluate(STATE)
                assert cancelled['workerReleased'] and cancelled['queue']['state']=='paused'
                done=sum(n['status']=='completed' for n in cancelled['queue']['notes']);assert 10<=done<100
                assert any(n['status'] in ['cancelled','pending'] for n in cancelled['queue']['notes'])
                post_cancel=settle(page,meter)
                page.screenshot(path=str(OUT/f'{profile}-{mode}-cancelled.png'))
                assert not errors,errors
                assert all(url.startswith(URL) or url.startswith('blob:') for url in network),'Unexpected note/model network request'
                assert not meter.errors,meter.errors
                report={'profile':profile,'mode':mode,'precision':'fp32','browser':browser.version,'gpuDevices':gpu_devices,'assetVersion':json.loads((ROOT/'dist/asset-manifest.json').read_text(encoding='utf-8'))['version'],'logicalProcessors':os.cpu_count(),'sampleIntervalSeconds':meter.interval,'corpusSha256':hashlib.sha256(corpus).hexdigest(),'notes':100,'modelReady':model_ready,'beforeImport':before_import,'import':meter.summarize(before_import,model_ready),'completion':meter.summarize(start,end),'afterCompletion':post_complete,'cancellation':meter.summarize(cancel_start,cancel_end),'cancelledAfterNotes':done,'afterCancellation':post_cancel,'workerReleasedAfterBoth':True,'queueResumeEnabled':page.get_by_test_id('assist-batch-resume').is_enabled(),'retainedCompletedRuns':100+done,'outputs':complete['rows'],'samples':meter.samples,'measurementErrors':meter.errors}
                report['transientProcessExits']=meter.transient_exits
                (OUT/f'{profile}-{mode}.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
                print(json.dumps({'profile':profile,'mode':mode,'completion':report['completion'],'afterCompletion30s':post_complete['30'],'afterCancel30s':post_cancel['30']}),flush=True)
            except Exception:
                page.screenshot(path=str(OUT/f'{profile}-{mode}-failure.png'))
                (OUT/f'{profile}-{mode}-partial.json').write_text(json.dumps({'samples':meter.samples,'errors':meter.errors,'state':page.evaluate(STATE)},indent=2),encoding='utf-8')
                raise
            finally:meter.stop();context.close();browser.close()
