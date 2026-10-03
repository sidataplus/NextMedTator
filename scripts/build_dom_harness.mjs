/** Test-only CommonJS bundle for about:blank. Does not make network requests. */
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),modules=[];
for(const file of await readdir('src/nextmedtator',{recursive:true})){
 if(!file.endsWith('.mjs')||['onnx-worker.mjs','compare-worker.mjs'].includes(file))continue;
 let text=await readFile(`src/nextmedtator/${file}`,'utf8');
 text=text.replaceAll('import.meta.url',JSON.stringify(`https://unrequested.invalid/app/nextmedtator/${file}`));
 const result=ts.transpileModule(text,{fileName:file.replace('.mjs','.js'),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,allowJs:true}});
 modules.push(`${JSON.stringify(file)}:function(require,module,exports){${result.outputText}\n}`);
}
await mkdir('test-results',{recursive:true});
// Resolve each module's imports relative to that module, including vendored subdirectories.
await writeFile('test-results/dom-harness.js',`(()=>{const modules={${modules.join(',\n')}},cache={};function normalize(path){const parts=[];for(const p of path.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');}function require(path){const name=normalize(path);if(!cache[name]){if(!modules[name])throw Error('Unknown test module: '+name);const m={exports:{}};cache[name]=m;const dir=name.slice(0,name.lastIndexOf('/')+1);modules[name](p=>require(dir+p),m,m.exports);}return cache[name].exports;}window.__testRequire=require;require('ui.mjs');})()`);
