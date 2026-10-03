import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sqliteInit from '@sqlite.org/sqlite-wasm';
import {SQLiteCorpusIndex,searchExpression} from '../../src/nextmedtator/backend/search-engine.mjs';
import {SQLiteProjectStore} from '../../src/nextmedtator/backend/storage-engine.mjs';
import {loadCore} from '../../src/nextmedtator/backend/core-loader.mjs';
import {sourceDocument,canonical,clone} from '../../src/nextmedtator/integrity.mjs';
import {ReviewProject} from '../../src/nextmedtator/project.mjs';
import {DEMO_SCHEMA} from '../../src/nextmedtator/contracts.mjs';
const sqlite=await sqliteInit({wasmBinary:await readFile('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'),print:()=>{},printErr:()=>{}});
const core=await loadCore(await readFile('wasm/core/target/wasm32-unknown-unknown/release/nextmedtator_core.wasm'));
const docs=[{id:'a',name:'a.txt',text:'Metastatic breast cancer. MI HF DM AF RA. Café café.'},{id:'b',name:'b.txt',text:'Breast cancer metastatic. Diabetes diabetic. <img src=x onerror=alert(1)> cancer.'},{id:'c',name:'suicide_attempt.txt',text:'History of suicide attempt. No current suicidal thoughts.'}];
function memory(){const db=new sqlite.oo1.DB(':memory:','c');return {db,index:new SQLiteCorpusIndex(db)};}
async function project(text='Breast cancer'){return ReviewProject.create([await sourceDocument('shared-id',new TextEncoder().encode(text),{provenance:{filename:'clinical.txt'}})],DEMO_SCHEMA);}
test('English words, ordered phrases, prefixes, abbreviations and diacritics use actual FTS5',async()=>{const {db,index}=memory();try{await index.index({projectId:'p',revision:1,documents:docs});const search=(query,mode='words')=>index.search({projectId:'p',revision:1,query,mode});assert.equal(search('breast cancer').total,2);assert.equal(search('metastatic/cancer').total,2);assert.equal(search('metastatic breast','phrase').total,1);assert.equal(search('diabet','prefix').hits[0].documentId,'b');for(const token of ['MI','HF','DM','AF','RA','cafe'])assert.equal(search(token).total,1);assert.equal(search('"suicide attempt" OR suicid*','advanced').total,1);assert.equal(search('').total,0);assert.equal(search('absent').total,0);assert.throws(()=>search('"unfinished','advanced'),e=>e.code==='SEARCH_QUERY_INVALID');assert.throws(()=>search('cancer','wrong'));assert.equal(searchExpression('a"b','phrase'),'"a""b"');assert.equal(search("x'; DROP TABLE documents;--").total,0);assert.equal(db.selectValue('SELECT COUNT(*) FROM documents'),3);}finally{db.close();}});
test('BM25 ranks stronger matches, deterministic pages are scoped and snippets are safe text',async()=>{const {db,index}=memory();try{await index.index({projectId:'p',revision:1,documents:[...docs,{id:'d',name:'d',text:'cancer cancer cancer cancer cancer'}]});await index.index({projectId:'other',revision:1,documents:[{id:'a',name:'private',text:'cancer PRIVATE_OTHER_PROJECT'}]});const args={projectId:'p',revision:1,query:'cancer',limit:1};const first=index.search(args),second=index.search({...args,offset:1});assert.equal(first.total,3);assert.equal(first.hits[0].documentId,'d');assert.ok(Number.isFinite(first.hits[0].rank));assert.ok(first.hits[0].rank<=second.hits[0].rank);assert.notEqual(first.hits[0].documentId,second.hits[0].documentId);assert.equal(index.search({...args,offset:3}).hits.length,0);const hit=index.search({...args,query:'onerror',limit:10}).hits[0];assert.ok(hit.parts.some(p=>p.match&&p.text==='onerror'));assert.match(hit.snippet,/<img/);assert.equal(hit.snippet,hit.parts.map(p=>p.text).join(''));assert.ok(!index.search({...args,query:'PRIVATE_OTHER_PROJECT'}).total);assert.equal(hit.sourceHash.length,64);}finally{db.close();}});
test('live replace, removal, source edits and failures never leave stale FTS rows',async()=>{
 const {db,index}=memory();try{
  await index.index({projectId:'p',revision:1,documents:docs});
  await assert.rejects(index.index({projectId:'p',revision:2,documents:[docs[0],docs[0]]}));
  assert.equal(index.search({projectId:'p',revision:1,query:'cancer'}).total,2);
  db.exec("CREATE TRIGGER injected_search_failure BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  await assert.rejects(index.index({projectId:'p',revision:2,documents:[{...docs[0],text:'renal disease'}]}));
  assert.equal(index.search({projectId:'p',revision:1,query:'cancer'}).total,2);
  db.exec('DROP TRIGGER injected_search_failure');
  await index.index({projectId:'p',revision:2,documents:[{...docs[0],text:'renal disease'}]});
  assert.equal(index.search({projectId:'p',revision:2,query:'cancer'}).total,0);
  assert.equal(index.search({projectId:'p',revision:2,query:'renal'}).total,1);
  assert.throws(()=>index.search({projectId:'p',revision:1,query:'renal'}),e=>e.code==='SEARCH_STALE');
  await assert.rejects(index.index({projectId:'p',revision:1,documents:docs}));
  await index.index({projectId:'p',revision:3,documents:[]});
  assert.equal(index.search({projectId:'p',revision:3,query:'renal'}).total,0);
  db.exec("INSERT INTO document_fts(document_fts,rank) VALUES('integrity-check',1)");
 }finally{db.close();}
});
test('persistent FTS checkpoint transactions, delete, export and v2 migration retain native hashes',async()=>{const db=new sqlite.oo1.DB(':memory:','c');try{let store=new SQLiteProjectStore(db,core),p=await project(),hash=await store.checkpoint(p.current,null);const other=await project('Cancer PRIVATE_OTHER_PROJECT');await store.checkpoint(other.current,null);assert.equal(store.search({projectId:p.current.id,query:'cancer'}).total,1);assert.equal(store.search({projectId:p.current.id,query:'PRIVATE_OTHER_PROJECT'}).total,0);const original=canonical((await store.read(p.current.id)).data);for(const trigger of ['documents_fts_insert','documents_fts_delete','documents_fts_update'])db.exec('DROP TRIGGER '+trigger);db.exec('DROP TABLE document_fts; DROP VIEW document_search_content; PRAGMA user_version=2;');store=new SQLiteProjectStore(db,core);assert.equal(db.selectValue('PRAGMA user_version'),3);assert.equal((await store.read(p.current.id)).hash,hash);assert.equal(canonical((await store.read(p.current.id)).data),original);assert.equal(store.search({projectId:p.current.id,query:'cancer'}).total,1);const replacement=clone((await project('Diabetes')).current);replacement.id=p.current.id;db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'failure'); END");await assert.rejects(store.checkpoint(replacement,hash));assert.equal(store.search({projectId:p.current.id,query:'cancer'}).total,1);db.exec('DROP TRIGGER injected_failure');hash=await store.checkpoint(replacement,hash);assert.equal(store.search({projectId:p.current.id,query:'cancer'}).total,0);assert.equal(store.search({projectId:p.current.id,query:'diabetes'}).total,1);store.forget(p.current.id,hash);assert.equal(store.search({projectId:p.current.id,query:'diabetes'}).total,0);db.exec("INSERT INTO document_fts(document_fts,rank) VALUES('integrity-check',1)");store.clear();assert.equal(store.search({projectId:other.current.id,query:'cancer'}).total,0);}finally{db.close();}});
test('failed v2 index migration rolls back schema changes without changing the portable checkpoint',async()=>{
 const db=new sqlite.oo1.DB(':memory:','c');try{
  const store=new SQLiteProjectStore(db,core),p=await project(),hash=await store.checkpoint(p.current,null);
  for(const trigger of ['documents_fts_insert','documents_fts_delete','documents_fts_update'])db.exec('DROP TRIGGER '+trigger);
  db.exec('DROP TABLE document_fts; DROP VIEW document_search_content; PRAGMA user_version=2;');
  db.exec("UPDATE documents SET document_json='invalid json'");
  assert.throws(()=>new SQLiteProjectStore(db,core));
  assert.equal(db.selectValue('PRAGMA user_version'),2);
  assert.equal(db.selectValue("SELECT COUNT(*) FROM sqlite_master WHERE name='document_fts'"),0);
  assert.equal(db.selectValue('SELECT hash FROM projects'),hash);
  assert.equal(db.selectValue('SELECT project_json FROM projects'),canonical(p.current));
  db.exec({sql:'UPDATE documents SET document_json=?',bind:[canonical(p.current.documents[0])]});
  assert.equal(new SQLiteProjectStore(db,core).search({projectId:p.current.id,query:'cancer'}).total,1);
 }finally{db.close();}
});
