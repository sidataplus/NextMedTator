"""Smoke gate on the original annotation UI with the docked assistance panel."""
from pathlib import Path
import os
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect
from gliner_worker_fixture import check_worker_regressions
ROOT=Path(__file__).resolve().parents[2]
URL='http://127.0.0.1:4174/'

def run():
    server=subprocess.Popen(['python','scripts/serve_static.py','--directory','dist','--port','4174'],cwd=ROOT)
    try:
        for _ in range(100):
            try:urllib.request.urlopen(URL,timeout=1).close();break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Static legacy preview not available')
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
            browser=p.chromium.launch(executable_path=executable if Path(executable).exists() else None,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];requests=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:requests.append(r.url))
            page.goto(URL);page.locator('#tab_link_annotation').wait_for();page.wait_for_function('window.app_hotpot?.vpp != null')
            # Exercise the upgraded sanitizer through the application's method,
            # and render the chart families used by the legacy analysis views.
            compatibility=page.evaluate('''() => {
                const host=document.createElement('div');
                const dirty='<img src="x" onerror="window.__nmtInjected=true"><a href="javascript:alert(1)">unsafe</a><script>window.__nmtInjected=true</script><b>kept</b>';
                host.innerHTML=window.app_hotpot.vpp.nmtSanitize(dirty);
                const safe=!host.querySelector('script,[onerror],a[href]') && host.querySelector('b')?.textContent==='kept';
                const chartHost=document.createElement('div');
                chartHost.style.cssText='width:600px;height:400px';document.body.append(chartHost);
                const chart=echarts.init(chartHost,null,{renderer:'svg'});
                const options=[
                    {series:[{type:'pie',data:[{name:'A',value:2},{name:'B',value:3}]}]},
                    {xAxis:{},yAxis:{},series:[{type:'scatter',data:[[1,2],[2,3]]}]},
                    {xAxis:{type:'category',data:['A','B']},yAxis:{type:'category',data:['C']},visualMap:{min:0,max:3},series:[{type:'heatmap',data:[[0,0,2],[1,0,3]]}]}
                ];
                const rendered=options.map(option=>{
                    chart.setOption({...option,animation:false},true);
                    return chartHost.querySelectorAll('svg path').length>0 && chart.getOption().series[0].data.length===2;
                });
                chart.dispose();chartHost.remove();
                return {safe,rendered,injected:Boolean(window.__nmtInjected)};
            }''')
            assert compatibility=={'safe':True,'rendered':[True,True,True],'injected':False},compatibility
            page.wait_for_timeout(500)
            page.wait_for_timeout(700)
            if page.locator('#start-screen').is_visible():
                cont=page.locator('#start-screen a', has_text='Continue')
                if cont.count():cont.first.click()
                else:page.evaluate('jarvis.ssclose()')
            page.locator('#start-screen').wait_for(state='hidden')
            page.locator('nextmedtator-assist').wait_for()
            page.get_by_test_id('assist-mode').wait_for()
            expect(page.get_by_test_id('assist-analyze')).to_be_disabled()
            page.get_by_title('Load a minimal task').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            expect(page.get_by_test_id('assist-analyze')).to_be_enabled()
            page.get_by_test_id('assist-analyze').click()
            expect(page.get_by_test_id('assist-message')).to_contain_text('Import a GLiNER2.5 boundary model package')
            page.get_by_test_id('assist-collapse').click()
            page.get_by_test_id('assist-expand').wait_for()
            assert page.locator('nextmedtator-assist').get_attribute('data-open')=='false'
            page.locator('#mui_filelist').wait_for();page.locator('#cm_editor').wait_for();page.locator('#dropzone_dtd').wait_for()
            page.get_by_test_id('assist-expand').click()
            page.get_by_test_id('assist-mode').select_option('blind')
            page.get_by_role('link', name='Statistics').click()
            page.get_by_role('link', name='Export').click()
            page.get_by_role('link', name='Adjudication').click()
            page.locator('#tab_link_annotation').click()
            page.locator('.file-list-item-name', has_text='doc_01.txt.xml').wait_for()
            page.get_by_test_id('open-workspace').click();page.get_by_test_id('source').wait_for()
            assert page.evaluate('document.querySelector("nextmedtator-workspace").workspace.project.current.documents.length') == 1
            page.get_by_role('button', name='Back to MedTator', exact=True).click()
            page.locator('#tab_link_annotation').wait_for()
            page.locator('#mui_dtdlist').wait_for()
            check_worker_regressions(page)
            assert errors==[],errors
            assert all(r.startswith(URL) for r in requests),requests
            browser.close()
    finally:server.terminate();server.wait(timeout=5)
if __name__=='__main__':run()
