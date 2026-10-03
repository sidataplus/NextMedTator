import {canonical,invariant,ValidationError,sha256,assertUnicode,LIMITS} from '../integrity.mjs';

// The external-content view reads canonical document JSON; no second durable
// copy of source text is needed. FTS rowids are internal, never document IDs.
export const SEARCH_DDL=`
CREATE VIEW IF NOT EXISTS document_search_content AS
 SELECT rowid,project_id,id AS document_id,source_hash,
 COALESCE(json_extract(document_json,'$.provenance.filename'),json_extract(document_json,'$.name'),id) AS name,
 json_extract(document_json,'$.text') AS text FROM documents;
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(name,text,content='document_search_content',content_rowid='rowid',tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
 INSERT INTO document_fts(rowid,name,text) SELECT rowid,name,text FROM document_search_content WHERE rowid=new.rowid; END;
CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
 INSERT INTO document_fts(document_fts,rowid,name,text) VALUES('delete',old.rowid,
 COALESCE(json_extract(old.document_json,'$.provenance.filename'),json_extract(old.document_json,'$.name'),old.id),json_extract(old.document_json,'$.text')); END;
CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE ON documents BEGIN
 INSERT INTO document_fts(document_fts,rowid,name,text) VALUES('delete',old.rowid,
 COALESCE(json_extract(old.document_json,'$.provenance.filename'),json_extract(old.document_json,'$.name'),old.id),json_extract(old.document_json,'$.text'));
 INSERT INTO document_fts(rowid,name,text) SELECT rowid,name,text FROM document_search_content WHERE rowid=new.rowid; END;
`;

export function searchExpression(query,mode='words'){
    invariant(typeof query==='string'&&query.length<=2000,'Search query must be at most 2000 characters','SEARCH_QUERY_INVALID');
    invariant(['words','phrase','prefix','advanced'].includes(mode),'Unsupported search mode','SEARCH_QUERY_INVALID');
    const value=query.trim();if(!value)return '';
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    if(mode==='advanced')return value;
    if(mode==='phrase')return quote(value);
    // Ordinary English punctuation separates words; quoting protects syntax.
    // This is query preparation, never a lexical/annotation rule tokenizer.
    const words=value.match(/[\p{L}\p{N}\p{M}\p{Co}]+/gu)??[];
    return words.map(s=>quote(s)+(mode==='prefix'?'*':'')).join(' AND ');
}

export function searchDocuments(db,{projectId,query,mode='words',limit=50,offset=0}={}){
    invariant(typeof projectId==='string'&&projectId.length>0&&projectId.length<=256,'A project is required');
    invariant(Number.isInteger(limit)&&limit>0&&limit<=100&&Number.isInteger(offset)&&offset>=0&&offset<=1000000,'Invalid search page','SEARCH_QUERY_INVALID');
    const expression=searchExpression(query,mode);
    const rows=(sql,bind=[])=>db.exec({sql,bind,rowMode:'object',returnValue:'resultRows'});
    const documentCount=rows('SELECT COUNT(*) AS count FROM documents WHERE project_id=?',[projectId])[0].count;
    if(!expression)return {hits:[],total:0,documentCount,limit,offset};
    // Random separators keep literal HTML and user-authored marker strings as
    // plain text. Consumers receive text segments, never trusted HTML/offsets.
    const token=crypto.randomUUID(),start=`\u0001${token}:start\u0002`,end=`\u0001${token}:end\u0002`;
    try{
        const total=rows('SELECT COUNT(*) AS count FROM document_fts JOIN document_search_content d ON d.rowid=document_fts.rowid WHERE document_fts MATCH ? AND d.project_id=?',[expression,projectId])[0].count;
        const hits=rows(`SELECT d.document_id AS documentId,d.name,d.source_hash AS sourceHash,bm25(document_fts) AS rank,
            snippet(document_fts,1,?,?,' … ',24) AS markedSnippet
            FROM document_fts JOIN document_search_content d ON d.rowid=document_fts.rowid
            WHERE document_fts MATCH ? AND d.project_id=? ORDER BY rank,d.document_id LIMIT ? OFFSET ?`,[start,end,expression,projectId,limit,offset]).map(({markedSnippet,...hit})=>{
                const parts=[];let remaining=markedSnippet;
                while(remaining){const a=remaining.indexOf(start);if(a<0){parts.push({text:remaining,match:false});break;}
                    if(a)parts.push({text:remaining.slice(0,a),match:false});remaining=remaining.slice(a+start.length);const b=remaining.indexOf(end);
                    invariant(b>=0,'Search snippet markers are invalid');parts.push({text:remaining.slice(0,b),match:true});remaining=remaining.slice(b+end.length);}
                return {...hit,snippet:parts.map(p=>p.text).join(''),parts};
            });
        return {hits,total,documentCount,limit,offset};
    }catch(error){
        if(/fts5:|unterminated string|syntax error|no such column/i.test(error.message))throw new ValidationError('Invalid search expression. Use words, a quoted phrase, prefixes such as diabet*, or AND/OR/NOT.','SEARCH_QUERY_INVALID');
        throw error;
    }
}

/** Volatile retrieval only: no checkpoints, annotation layers or rule results. */
export class SQLiteCorpusIndex{
    constructor(db){this.db=db;this.revisions=new Map();db.exec(`CREATE TABLE documents(project_id TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,source_hash TEXT NOT NULL,document_json TEXT NOT NULL,PRIMARY KEY(project_id,id));${SEARCH_DDL}`);}
    async index({projectId,documents,revision}){
        invariant(typeof projectId==='string'&&projectId.length>0&&projectId.length<=256&&Array.isArray(documents)&&documents.length<=LIMITS.documents,'Invalid or oversized search corpus');
        invariant(Number.isSafeInteger(revision)&&revision>=0,'Invalid corpus revision');
        invariant(revision>=(this.revisions.get(projectId)??-1),'Stale corpus revision','SEARCH_STALE');
        const ids=new Set(),prepared=[];
        for(const d of documents){invariant(typeof d.id==='string'&&d.id.length>0&&!ids.has(d.id),'Duplicate or invalid search document ID');ids.add(d.id);
            invariant(typeof d.name==='string'&&d.name.length<=4096&&typeof d.text==='string','Invalid search document');assertUnicode(d.text);
            prepared.push({...d,sourceHash:await sha256(new TextEncoder().encode(d.text))});}
        const exec=(sql,bind=[])=>this.db.exec({sql,bind});exec('BEGIN IMMEDIATE');
        try{exec('DELETE FROM documents WHERE project_id=?',[projectId]);prepared.forEach((d,i)=>exec('INSERT INTO documents VALUES(?,?,?,?,?)',[projectId,d.id,i,d.sourceHash,canonical({id:d.id,name:d.name,text:d.text})]));exec('COMMIT');this.revisions.set(projectId,revision);}
        catch(error){try{exec('ROLLBACK');}catch{}throw error;}
        return {revision,documentCount:documents.length,persistent:false};
    }
    search(args){const revision=this.revisions.get(args.projectId);invariant(revision!==undefined&&args.revision===revision,'Corpus changed; refresh search','SEARCH_STALE');return {...searchDocuments(this.db,args),revision,persistent:false};}
}
