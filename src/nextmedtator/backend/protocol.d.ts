/** Worker interfaces are private to this origin; no SQL or arbitrary code crosses them. */
export type CoreOperation = 'health' | 'validate' | 'compare' | 'offsets' | 'search';
export type StorageOperation = 'health' | 'checkpoint' | 'read' | 'list' | 'forget' | 'clear' | 'query' | 'export' | 'indexCorpus' | 'search';
export interface Request<T extends CoreOperation | StorageOperation> { id: number; operation: T; args: Record<string, unknown>; }
export type Reply<T> = { id: number; value: T } | { id: number; error: {code: string; message: string} };
export interface Checkpoint { project: object; expectedHash: string | null; }
export interface StoredProject { data: object; hash: string; }
export type ProjectQuery = 'summary' | 'records' | 'events';
export interface SearchQuery {projectId:string;query:string;mode?:'words'|'phrase'|'prefix'|'advanced';limit?:number;offset?:number;revision?:number;}
export interface SearchHit {documentId:string;name:string;sourceHash:string;rank:number;snippet:string;parts:{text:string;match:boolean}[];}
export interface SearchPage {hits:SearchHit[];total:number;documentCount:number;limit:number;offset:number;persistent:boolean;revision?:number;}
export interface CorpusIndexRequest {projectId:string;revision:number;documents:{id:string;name:string;text:string}[];}
