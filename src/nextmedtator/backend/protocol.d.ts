/** Worker interfaces are private to this origin; no SQL or arbitrary code crosses them. */
export type CoreOperation = 'health' | 'validate' | 'compare' | 'offsets' | 'search';
export type StorageOperation = 'health' | 'checkpoint' | 'read' | 'list' | 'forget' | 'clear' | 'query' | 'export';
export interface Request<T extends CoreOperation | StorageOperation> { id: number; operation: T; args: Record<string, unknown>; }
export type Reply<T> = { id: number; value: T } | { id: number; error: {code: string; message: string} };
export interface Checkpoint { project: object; expectedHash: string | null; }
export interface StoredProject { data: object; hash: string; }
export type ProjectQuery = 'summary' | 'records' | 'events';
