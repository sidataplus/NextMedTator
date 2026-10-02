/** Test-only CommonJS bundle for about:blank. Does not make network requests. */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let ts;
try {
    ts = require('typescript');
}
catch {
    ts = require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript`);
}
const modules = [];
for (const file of await readdir('src/nextmedtator')) {
    if (!file.endsWith('.mjs') || file === 'onnx-worker.mjs')
        continue;
    let text = await readFile(`src/nextmedtator/${file}`, 'utf8');
    text = text.replaceAll('import.meta.url', JSON.stringify(`https://unrequested.invalid/app/nextmedtator/${file}`));
    const result = ts.transpileModule(text, { fileName: file.replace('.mjs', '.js'), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true } });
    modules.push(`${JSON.stringify(file)}:function(require,module,exports){${result.outputText}\n}`);
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/dom-harness.js', `(()=>{const modules={${modules.join(',\n')}},cache={};function require(path){const name=path.replace(/^\.\\//,'');if(!cache[name]){if(!modules[name])throw Error('Unknown test module: '+name);const m={exports:{}};cache[name]=m;modules[name](require,m,m.exports);}return cache[name].exports;}window.__testRequire=require;require('ui.mjs');})()`);
