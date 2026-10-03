/** Build-time hardening of the legacy UI. Requires full upstream browser qualification. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { parse } from 'acorn';
import compiler from 'vue-template-compiler';
import { transform } from 'esbuild';
const out = 'dist';
const { document } = parseHTML(await readFile(`${out}/index.html`, 'utf8'));
const app = document.querySelector('#app_hotpot');
if (!app)
    throw Error('Upstream mount point changed');
const scripts = [...document.querySelectorAll('script')].filter(s => !s.hasAttribute('src') && s.textContent.trim());
if (!scripts.length)
    throw Error('Upstream initialization script missing');
const templates = new Set();
function walk(node) {
    if (!node || typeof node !== 'object')
        return;
    if (node.type === 'Property' && (node.key.name ?? node.key.value) === 'template') {
        const v = node.value;
        if (v.type === 'TemplateLiteral' && !v.expressions.length)
            templates.add(v.quasis[0].value.cooked);
        else if (v.type === 'Literal' && typeof v.value === 'string')
            templates.add(v.value);
        else
            throw Error('Dynamic Vue template requires explicit build-time migration');
    }
    for (const v of Object.values(node)) {
        if (Array.isArray(v))
            v.forEach(walk);
        else if (v && typeof v === 'object')
            walk(v);
    }
}
for (const s of scripts)
    walk(parse(s.textContent, { ecmaVersion: 'latest', sourceType: 'script' }));
function compile(template) {
    const safe = template.replace(/v-html="([^"]+)"/g, (_, expression) => `v-html="nmtSanitize(${expression})"`);
    const result = compiler.compile(safe);
    if (result.errors.length)
        throw Error(JSON.stringify(result.errors));
    return `{render:function(){${result.render}},staticRenderFns:[${result.staticRenderFns.map(f => `function(){${f}}`).join(',')}]}`;
}
await mkdir(`${out}/app`, { recursive: true });
const precompiled = `/* Build-time Vue render functions, never imported clinical templates. */
var nmtTemplates=new Map([${[...templates].map(t => `[${JSON.stringify(t)},${compile(t)}]`).join(',')}]);
var nmtRoot=${compile(app.outerHTML)};
Vue.mixin({methods:{nmtSanitize:function(value){return DOMPurify.sanitize(String(value==null?'':value),{USE_PROFILES:{html:true}});}},beforeCreate:function(){var o=this.$options;var r=o.el==='#app_hotpot'?nmtRoot:nmtTemplates.get(o.template);if(r){o.render=r.render;o.staticRenderFns=r.staticRenderFns;delete o.template;}else if(o.template){throw Error('Uncompiled Vue template blocked');}}});`;
await writeFile(`${out}/app/legacy-render.js`, precompiled);
const last = scripts.at(-1);
for (const src of ['./vendor/dompurify/purify.min.js', './app/legacy-render.js']) {
    const tag = document.createElement('script');
    tag.setAttribute('src', src);
    last.before(tag);
}
for (const [i, s] of scripts.entries()) {
    const result = await transform(s.textContent, { target: 'es2020', drop: ['console', 'debugger'] });
    await writeFile(`${out}/app/legacy-${i}.js`, result.code);
    s.textContent = '';
    s.setAttribute('src', `./app/legacy-${i}.js`);
}
for (const node of document.querySelectorAll('*'))
    for (const a of [...node.attributes])
        if (/^on/i.test(a.name))
            throw Error(`Inline handler needs migration: ${a.name}`);
if ((await stat('src/nextmedtator/ui.mjs').catch(() => null))?.isFile()) {
    const module = document.createElement('script');
    module.setAttribute('type', 'module');
    module.setAttribute('src', './app/nextmedtator/ui.mjs');
    document.body.append(module);
}
await writeFile(`${out}/index.html`, '<!doctype html>\n' + document.documentElement.outerHTML);
execFileSync('uv', ['run', '--locked', 'python', '-c', "from scripts.build_preview import HEADERS,offline_assets; from pathlib import Path; p=Path('dist'); (p/'_headers').write_text(HEADERS); offline_assets(p)"], { stdio: 'inherit' });
console.log('Built static NextMedTator. Run original-workflow/browser gates before release.');
