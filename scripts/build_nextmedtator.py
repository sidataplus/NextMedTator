"""Render upstream MedTator with compatible upgraded local dependencies.

Apply this overlay to the pinned fork first. This is not a production server.
"""
from pathlib import Path
import shutil
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def build() -> None:
    if not (ROOT/'web.py').exists():
        raise SystemExit('Apply this overlay to sidataplus/NextMedTator first. For an isolated preview use scripts/build_preview.py.')
    import web
    out=ROOT/'dist'
    if out.exists():shutil.rmtree(out)
    shutil.copytree(ROOT/'docs/static',out/'static')
    web.app.config.update(LIB_BASE='local',DEBUG=False)
    libs=web.app.config['THIRD_PARTY_LIB_URL']['local']
    copies={
      'VUE':('vue',{'JS':'dist/vue.runtime.min.js'}),
      'JQUERY':('jquery',{'JS':'dist/jquery.min.js'}),
      'JQUERY_UI':('jquery-ui-dist',{'JS':'jquery-ui.min.js','CSS':'jquery-ui.min.css'}),
      'FONT_AWESOME':('@fortawesome/fontawesome-free',{'CSS':'css/all.min.css'}),
      'JSZIP':('jszip',{'JS':'dist/jszip.min.js'}),
      'FILESAVER':('file-saver',{'JS':'dist/FileSaver.min.js'}),
      'DAYJS':('dayjs',{'JS':'dayjs.min.js'}),
      'PAPAPARSE':('papaparse',{'JS':'papaparse.min.js'}),
      'JS_YAML':('js-yaml',{'JS':'dist/js-yaml.min.js'}),
      'D3':('d3',{'JS':'dist/d3.min.js'}),
      'ECHARTS':('echarts',{'JS':'dist/echarts.min.js'})
    }
    notices=[]
    for key,(package,paths) in copies.items():
        source=ROOT/'node_modules'/package
        if not source.is_dir():raise RuntimeError(f'Run pnpm install: missing {package}')
        target=out/'vendor'/package
        shutil.copytree(source,target,ignore=shutil.ignore_patterns('node_modules','.git'))
        for kind,filename in paths.items():
            if not (target/filename).is_file():raise RuntimeError(f'Missing library artifact: {package}/{filename}')
            libs[key][kind]=f'./vendor/{package}/{filename}'
        notices.append(package)
    cm=out/'vendor/codemirror';shutil.copytree(ROOT/'node_modules/codemirror',cm)
    for key,old in list(libs['CODE_MIRROR'].items()):
        rel=old.split('codemirror/',1)[1].replace('.min.','.')
        if rel in ('codemirror.js','codemirror.css'):rel='lib/'+rel
        if not (cm/rel).is_file():raise RuntimeError(f'Missing CodeMirror artifact: {rel}')
        libs['CODE_MIRROR'][key]='./vendor/codemirror/'+rel
    shutil.copytree(ROOT/'node_modules/dompurify/dist',out/'vendor/dompurify')
    if (ROOT/'src/nextmedtator').exists():
        shutil.copytree(ROOT/'src/nextmedtator',out/'app/nextmedtator')
    runtime=ROOT/'node_modules/onnxruntime-web/dist'
    if not runtime.is_dir():raise RuntimeError('Missing local ONNX Runtime Web package')
    target=out/'vendor/ort';target.mkdir(parents=True)
    # Copy the consistent runtime family; a manifest audit rejects oversized files.
    for p in runtime.iterdir():
        if p.is_file() and (p.name=='ort.webgpu.min.mjs' or (p.name.startswith('ort-wasm-simd-threaded') and p.suffix in ('.mjs','.wasm'))):
            shutil.copyfile(p,target/p.name)
    with web.app.test_request_context('/'):
        html=web.index()
    html=html.replace('<title>MedTator</title>','<title>NextMedTator</title>')
    html=html.replace('href="https://github.com/OHNLP/MedTator"','href="https://github.com/sidataplus/NextMedTator"')
    (out/'index.html').write_text(html,encoding='utf-8')
    (out/'404.html').write_text('<!doctype html><title>Not found</title><h1>Not found</h1><a href="/">NextMedTator</a>')
    (out/'DEPENDENCIES.txt').write_text('Upgraded locally served packages:\n'+'\n'.join(notices)+'\n\nOther legacy vendored assets remain pending audit. See repository dependency review.\n')
    print('Rendered upstream layout. Next step: precompile Vue and externalize scripts.')

if __name__=='__main__':build()
