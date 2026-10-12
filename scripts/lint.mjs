/** Syntax checks for maintained JavaScript and Python; no external lint service. */
import {readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
async function files(root){const out=[];for(const entry of await readdir(root,{withFileTypes:true})){if(['node_modules','.venv','__pycache__','target'].includes(entry.name))continue;const path=`${root}/${entry.name}`;if(entry.isDirectory())out.push(...await files(path));else out.push(path);}return out;}
const maintained=(await Promise.all(['src','scripts','tools/gliner-onnx/src','tests/unit','tests/browser','tests/validation'].map(files))).flat();
for(const path of maintained.filter(p=>p.endsWith('.mjs')))execFileSync(process.execPath,['--check',path],{stdio:'inherit'});
execFileSync('uv',['run','--locked','python','-c',`import ast,pathlib,json
for name in json.loads(${JSON.stringify(JSON.stringify(maintained.filter(p=>p.endsWith('.py')).concat(['config.py','web.py'])))}):
 ast.parse(pathlib.Path(name).read_text(),filename=name)
`],{stdio:'inherit'});
console.log('Maintained JavaScript/Python syntax passed. This is not a comprehensive style or security audit.');
