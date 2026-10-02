import { invariant, ValidationError } from './integrity.mjs';
const encoder = new TextEncoder();
export const ZIP_LIMITS = Object.freeze({ files: 20000, total: 128 * 1024 * 1024, file: 64 * 1024 * 1024, archive: 128 * 1024 * 1024 });
const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++)
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes)
    c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function safePath(path) { invariant(typeof path === 'string' && path.length > 0 && path.length < 512 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !path.includes(':') && !path.includes('%'), 'Unsafe archive path'); invariant(path.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe archive path'); return path; }
function concatenate(chunks) { const out = new Uint8Array(chunks.reduce((n, a) => n + a.length, 0)); let offset = 0; for (const a of chunks) {
    out.set(a, offset);
    offset += a.length;
} return out; }
/** Deterministic ZIP STORE writer. No compression library or zip64 dependency. */
export function zipStore(files, limits = ZIP_LIMITS) {
    invariant(files instanceof Map && files.size <= limits.files, 'Archive file limit');
    const chunks = [], central = [];
    let offset = 0, total = 0;
    for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        safePath(name);
        invariant(data instanceof Uint8Array && data.length <= limits.file, 'Archive member size limit');
        total += data.length;
        invariant(total <= limits.total, 'Archive expanded size limit');
        const filename = encoder.encode(name), crc = crc32(data);
        const local = new Uint8Array(30 + filename.length), v = new DataView(local.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x800, true);
        v.setUint16(12, 33, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, data.length, true);
        v.setUint32(22, data.length, true);
        v.setUint16(26, filename.length, true);
        local.set(filename, 30);
        const c = new Uint8Array(46 + filename.length), cv = new DataView(c.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x800, true);
        cv.setUint16(14, 33, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, filename.length, true);
        cv.setUint32(42, offset, true);
        c.set(filename, 46);
        chunks.push(local, data);
        central.push(c);
        offset += local.length + data.length;
    }
    const directory = concatenate(central), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.size, true);
    ev.setUint16(10, files.size, true);
    ev.setUint32(12, directory.length, true);
    ev.setUint32(16, offset, true);
    const result = concatenate([...chunks, directory, end]);
    invariant(result.length <= limits.archive, 'Compressed archive size limit');
    return result;
}
async function inflateBounded(bytes, expected) {
    let stream;
    try {
        stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    }
    catch {
        throw new ValidationError('This browser cannot read deflated ZIPs. Re-export as an uncompressed NextMedTator bundle.');
    }
    const reader = stream.getReader(), chunks = [];
    let n = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            n += value.length;
            if (n > expected) {
                await reader.cancel();
                throw new ValidationError('Expanded member exceeds its declared size');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    invariant(n === expected, 'Expanded member size mismatch');
    return concatenate(chunks);
}
export async function unzipBounded(bytes, limits = ZIP_LIMITS) {
    invariant(bytes instanceof Uint8Array && bytes.length >= 22 && bytes.length <= limits.archive, 'Invalid or oversized ZIP');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) {
            end = i;
            break;
        }
    }
    invariant(end >= 0, 'ZIP end record missing');
    invariant(v.getUint16(end + 4, true) === 0 && v.getUint16(end + 6, true) === 0, 'Multi-disk ZIP unsupported');
    const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), start = v.getUint32(end + 16, true);
    invariant(count === v.getUint16(end + 8, true) && count <= limits.files && count < 65535, 'ZIP file count invalid');
    invariant(start + size === end, 'ZIP directory bounds invalid');
    const entries = [];
    const names = new Set();
    let cursor = start, total = 0;
    const ranges = [];
    for (let i = 0; i < count; i++) {
        invariant(cursor + 46 <= end && v.getUint32(cursor, true) === 0x02014b50, 'Invalid ZIP directory entry');
        const flags = v.getUint16(cursor + 8, true), method = v.getUint16(cursor + 10, true), crc = v.getUint32(cursor + 16, true), compressed = v.getUint32(cursor + 20, true), expanded = v.getUint32(cursor + 24, true), length = v.getUint16(cursor + 28, true), extra = v.getUint16(cursor + 30, true), comment = v.getUint16(cursor + 32, true), local = v.getUint32(cursor + 42, true);
        invariant((flags & 0x41) === 0 && [0, 8].includes(method), 'Encrypted or unsupported ZIP member');
        invariant(cursor + 46 + length + extra + comment <= end && expanded <= limits.file, 'ZIP member exceeds limits');
        total += expanded;
        invariant(total <= limits.total, 'ZIP expanded size exceeds limit');
        let name;
        try {
            name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + length));
        }
        catch {
            throw new ValidationError('Archive filenames must be UTF-8');
        }
        safePath(name);
        invariant(!names.has(name), 'Duplicate ZIP path');
        names.add(name);
        invariant(local + 30 <= start && v.getUint32(local, true) === 0x04034b50, 'Invalid local ZIP header');
        const localLen = v.getUint16(local + 26, true), localExtra = v.getUint16(local + 28, true), body = local + 30 + localLen + localExtra;
        invariant(body + compressed <= start && v.getUint16(local + 8, true) === method && v.getUint16(local + 6, true) === flags, 'Local ZIP bounds/method mismatch');
        invariant(new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localLen)) === name, 'Local ZIP filename mismatch');
        if (!(flags & 8))
            invariant(v.getUint32(local + 14, true) === crc && v.getUint32(local + 18, true) === compressed && v.getUint32(local + 22, true) === expanded, 'Local ZIP sizes/CRC mismatch');
        ranges.push([local, body + compressed]);
        entries.push({ name, body, compressed, expanded, crc, method });
        cursor += 46 + length + extra + comment;
    }
    invariant(cursor === end, 'Unexpected ZIP directory bytes');
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++)
        invariant(ranges[i][0] >= ranges[i - 1][1], 'Overlapping ZIP members');
    const result = new Map();
    for (const e of entries) {
        const compressed = bytes.subarray(e.body, e.body + e.compressed);
        const data = e.method === 0 ? compressed.slice() : await inflateBounded(compressed, e.expanded);
        invariant(data.length === e.expanded && crc32(data) === e.crc, 'ZIP member integrity mismatch');
        result.set(e.name, data);
    }
    return result;
}
