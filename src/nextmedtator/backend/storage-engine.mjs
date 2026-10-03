import {canonical,sha256,jsonParse,invariant,ValidationError} from '../integrity.mjs';
import {validateProject} from '../contracts.mjs';
import {validateCore} from './core-loader.mjs';
export const STORAGE_VERSION=2;
const DDL=`
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at TEXT NOT NULL, project_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,ordinal INTEGER NOT NULL,source_hash TEXT NOT NULL,split TEXT NOT NULL,group_id TEXT,document_json TEXT NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS records(project_id TEXT NOT NULL,layer TEXT NOT NULL,id TEXT NOT NULL,document_id TEXT NOT NULL,family TEXT NOT NULL,ordinal INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(project_id,layer,id),FOREIGN KEY(project_id,document_id) REFERENCES documents(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS relations(project_id TEXT NOT NULL,layer TEXT NOT NULL,head_id TEXT NOT NULL,tail_id TEXT NOT NULL,type TEXT NOT NULL,ordinal INTEGER NOT NULL,FOREIGN KEY(project_id,layer,head_id) REFERENCES records(project_id,layer,id) ON DELETE CASCADE,FOREIGN KEY(project_id,layer,tail_id) REFERENCES records(project_id,layer,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS model_runs(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,ordinal INTEGER NOT NULL,document_id TEXT NOT NULL,fingerprint TEXT NOT NULL,run_json TEXT NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS snapshots(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,ordinal INTEGER NOT NULL,hash TEXT NOT NULL,kind TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS review_events(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,ordinal INTEGER NOT NULL,action TEXT NOT NULL,event_json TEXT NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS review_decisions(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,key TEXT NOT NULL,status TEXT NOT NULL,decision_json TEXT NOT NULL,PRIMARY KEY(project_id,key));
CREATE TABLE IF NOT EXISTS comparisons(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,hash TEXT NOT NULL,ordinal INTEGER NOT NULL,report_json TEXT NOT NULL,PRIMARY KEY(project_id,hash));
CREATE TABLE IF NOT EXISTS legacy_projects(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,document_id TEXT NOT NULL,key TEXT NOT NULL,child_id TEXT NOT NULL,schema_hash TEXT NOT NULL,project_json TEXT NOT NULL,PRIMARY KEY(project_id,document_id));
CREATE INDEX IF NOT EXISTS records_by_source ON records(project_id,layer,document_id,ordinal);
CREATE INDEX IF NOT EXISTS events_by_project ON review_events(project_id,ordinal);
`;
/** Only closed operations and bound parameters; imported schemas never become SQL. */
export class SQLiteProjectStore{
    constructor(db,core){this.db=db;this.core=core;db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE;');const version=db.selectValue('PRAGMA user_version');invariant(version===0||version===STORAGE_VERSION,'Unsupported local database version; export with the compatible app');db.exec(DDL);db.exec('PRAGMA user_version=2; PRAGMA application_id=1313698898;');}
    exec(sql,bind=[]){return this.db.exec({sql,bind});}
    rows(sql,bind=[]){return this.db.exec({sql,bind,rowMode:'object',returnValue:'resultRows'});}
    async checkpoint(project,expectedHash){
        await validateProject(project);validateCore(this.core,project);for(const child of project.extensions.legacyWorkspace?.children??[]){await validateProject(child.project);validateCore(this.core,child.project);}const payload=canonical(project),hash=await sha256(payload),id=project.id;
        this.exec('BEGIN IMMEDIATE');let committed=false;
        try{
            const old=this.rows('SELECT hash FROM projects WHERE id=?',[id])[0]?.hash??null;
            if(old!==expectedHash)throw new ValidationError('Recovery changed in another session. Export or branch; do not overwrite.','RECOVERY_CONFLICT');
            this.exec('DELETE FROM projects WHERE id=?',[id]);
            this.exec('INSERT INTO projects VALUES(?,?,?,?)',[id,hash,new Date().toISOString(),payload]);
            project.documents.forEach((d,i)=>this.exec('INSERT INTO documents VALUES(?,?,?,?,?,?,?)',[id,d.id,i,d.textSha256,d.split,d.groupId??null,canonical(d)]));
            const layers=[['draft',project.draft.records],...project.runs.map(r=>['run:'+r.id,r.records]),...project.snapshots.map(s=>['snapshot:'+s.id,s.records])];
            for(const [layer,records]of layers){records.forEach((r,i)=>this.exec('INSERT INTO records VALUES(?,?,?,?,?,?,?)',[id,layer,r.id,r.documentId,r.family,i,canonical(r)]));for(const r of records)(r.relations??[]).forEach((rel,i)=>this.exec('INSERT INTO relations VALUES(?,?,?,?,?,?)',[id,layer,r.id,rel.targetId,rel.type,i]));}
            for(const child of project.extensions.legacyWorkspace?.children??[])this.exec('INSERT INTO legacy_projects VALUES(?,?,?,?,?,?)',[id,child.documentId,child.key,child.project.id,child.project.schemaHash,canonical(child.project)]);
            project.runs.forEach((r,i)=>this.exec('INSERT INTO model_runs VALUES(?,?,?,?,?,?)',[id,r.id,i,r.documentId,r.fingerprint,canonical(r)]));
            project.snapshots.forEach((s,i)=>this.exec('INSERT INTO snapshots VALUES(?,?,?,?,?,?)',[id,s.id,i,s.hash,s.kind,canonical(s)]));
            project.events.forEach((e,i)=>this.exec('INSERT INTO review_events VALUES(?,?,?,?,?)',[id,e.id,i,e.action,canonical(e)]));
            for(const [key,d]of Object.entries(project.draft.decisions))this.exec('INSERT INTO review_decisions VALUES(?,?,?,?)',[id,key,d.status,canonical(d)]);
            (project.extensions.comparisons??[]).forEach((r,i)=>this.exec('INSERT OR IGNORE INTO comparisons VALUES(?,?,?,?)',[id,r.hash,i,canonical(r)]));
            const readback=this.rows('SELECT hash,project_json FROM projects WHERE id=?',[id])[0];invariant(readback?.hash===hash&&await sha256(readback.project_json)===hash,'Recovery read-back verification failed');
            this.exec('COMMIT');committed=true;return hash;
        }finally{if(!committed)try{this.exec('ROLLBACK');}catch{/* Original failure remains authoritative. */}}
    }
    async read(id){const row=this.rows('SELECT hash,project_json FROM projects WHERE id=?',[id])[0];if(!row)return null;invariant(await sha256(row.project_json)===row.hash,'Recovery integrity check failed');const data=jsonParse(row.project_json);await validateProject(data);validateCore(this.core,data);for(const child of data.extensions.legacyWorkspace?.children??[]){await validateProject(child.project);validateCore(this.core,child.project);}return {data,hash:row.hash,backend:'sqlite-opfs'};}
    list(){return this.rows('SELECT p.id,p.updated_at AS updatedAt,EXISTS(SELECT 1 FROM legacy_projects c WHERE c.project_id=p.id) AS corpus FROM projects p ORDER BY p.updated_at DESC,p.id').map(r=>({...r,backend:'sqlite-opfs'}));}
    forget(id,expectedHash){this.exec('BEGIN IMMEDIATE');try{invariant((this.rows('SELECT hash FROM projects WHERE id=?',[id])[0]?.hash??null)===expectedHash,'Recovery changed; deletion refused');this.exec('DELETE FROM projects WHERE id=?',[id]);this.exec('COMMIT');}catch(error){try{this.exec('ROLLBACK');}catch{}throw error;}}
    clear(){this.exec('BEGIN IMMEDIATE');try{this.exec('DELETE FROM projects');this.exec('COMMIT');}catch(error){try{this.exec('ROLLBACK');}catch{}throw error;}}
    query(id,{kind='summary',layer='draft',documentId=null,limit=100,offset=0}={}){
        invariant(Number.isInteger(limit)&&limit>0&&limit<=1000&&Number.isInteger(offset)&&offset>=0,'Invalid query page');
        if(kind==='summary')return {recordsByFamily:this.rows('SELECT family,COUNT(*) AS count FROM records WHERE project_id=? AND layer=? GROUP BY family ORDER BY family',[id,layer]),reviewStatuses:this.rows('SELECT status,COUNT(*) AS count FROM review_decisions WHERE project_id=? GROUP BY status ORDER BY status',[id]),documents:this.rows('SELECT id,split,group_id AS groupId FROM documents WHERE project_id=? ORDER BY ordinal LIMIT ? OFFSET ?',[id,limit,offset]),events:this.rows('SELECT COUNT(*) AS count FROM review_events WHERE project_id=?',[id])[0].count};
        if(kind==='records')return this.rows('SELECT record_json FROM records WHERE project_id=? AND layer=? AND (? IS NULL OR document_id=?) ORDER BY ordinal LIMIT ? OFFSET ?',[id,layer,documentId,documentId,limit,offset]).map(r=>jsonParse(r.record_json));
        if(kind==='events')return this.rows('SELECT event_json FROM review_events WHERE project_id=? ORDER BY ordinal LIMIT ? OFFSET ?',[id,limit,offset]).map(r=>jsonParse(r.event_json));
        throw new ValidationError('Unsupported local query');
    }
}
