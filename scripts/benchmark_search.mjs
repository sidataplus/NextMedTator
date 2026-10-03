/** Reproducible synthetic English workload; no clinical corpus is downloaded. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sqliteInit from '@sqlite.org/sqlite-wasm';
import {SQLiteCorpusIndex} from '../src/nextmedtator/backend/search-engine.mjs';
import {canonical} from '../src/nextmedtator/integrity.mjs';
const sqlite=await sqliteInit({wasmBinary:await readFile('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'),print:()=>{},printErr:()=>{}});
const db=new sqlite.oo1.DB(':memory:','c'),baseline=new sqlite.oo1.DB(':memory:','c');
try{
 const count=1000,documents=Array.from({length:count},(_,i)=>({id:'note-'+String(i).padStart(4,'0'),name:'synthetic-'+i+'.txt',text:(i%10===0?'Metastatic breast cancer. ':'Diabetes and hypertension. ')+('Synthetic clinical history with symptoms, medications, laboratory findings and follow-up. '.repeat(80))}));
 const index=new SQLiteCorpusIndex(db),args={projectId:'benchmark',revision:1,documents};
 let start=performance.now();await index.index(args);const buildMs=performance.now()-start;
 const timings=[];for(let i=0;i<30;i++){start=performance.now();const page=index.search({projectId:'benchmark',revision:1,query:'metastatic breast cancer',mode:'phrase',limit:25});if(page.total!==100||page.hits.length!==25)throw Error('Benchmark retrieval mismatch');timings.push(performance.now()-start);}
 start=performance.now();await index.index({...args,revision:2,documents:documents.map((d,i)=>i===0?{...d,text:'Changed synthetic note without prior disease term.'}:d)});const fullRefreshMs=performance.now()-start;
 if(index.search({projectId:'benchmark',revision:2,query:'metastatic breast cancer',mode:'phrase'}).total!==99)throw Error('Refresh left a stale hit');
 baseline.exec('CREATE TABLE documents(project_id TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,source_hash TEXT NOT NULL,document_json TEXT NOT NULL,PRIMARY KEY(project_id,id)); BEGIN;');documents.forEach((d,i)=>baseline.exec({sql:'INSERT INTO documents VALUES(?,?,?,?,?)',bind:['benchmark',d.id,i,'0'.repeat(64),canonical(d)]}));baseline.exec('COMMIT');
 const bytes=d=>d.selectValue('PRAGMA page_count')*d.selectValue('PRAGMA page_size');timings.sort((a,b)=>a-b);
 const report={workload:'1000 synthetic English clinical-style notes; unicode61 only',sqlite:sqlite.version.libVersion,documents:count,sourceBytes:documents.reduce((n,d)=>n+new TextEncoder().encode(d.text).length,0),databaseBytes:bytes(db),contentOnlyDatabaseBytes:bytes(baseline),approximateIndexOverheadBytes:bytes(db)-bytes(baseline),buildMs,fullRefreshMs,queryMedianMs:timings[15],queryP95Ms:timings[28],queries:30,qualification:'Cloud Node actual SQLite-WASM; synthetic workload, not target-device clinical-corpus qualification'};
 await mkdir('test-results',{recursive:true});await writeFile('test-results/search-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{db.close();baseline.close();}
