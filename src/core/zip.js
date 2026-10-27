// Minimal ZIP reader for phone use: stored + deflate entries, no ZIP64, no encryption.
// Uses DecompressionStream (all current browsers and Node >= 18). Entries are only ever read, never extracted to disk.
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function listZip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip_unsupported');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('zip_unsupported');
    const flags = u16(bytes, p + 8);
    const nameLen = u16(bytes, p + 28);
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      encrypted: (flags & 1) === 1,
      method: u16(bytes, p + 10),
      compSize: u32(bytes, p + 20),
      size: u32(bytes, p + 24),
      offset: u32(bytes, p + 42),
    });
    p += 46 + nameLen + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return entries;
}

export async function readZipEntry(bytes, entry) {
  if (entry.encrypted || entry.compSize === 0xffffffff || entry.size === 0xffffffff) throw new Error('zip_unsupported');
  if (u32(bytes, entry.offset) !== 0x04034b50) throw new Error('zip_unsupported');
  const start = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28);
  const data = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error('zip_unsupported');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** UTF-8 first; if the bytes are not valid UTF-8 fall back to Windows-1252 (common for German exports). */
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** Finds `lines.csv` (any folder, any case) inside a ZIP and returns its text. */
export async function readLinesCsvFromZip(bytes) {
  const entry = listZip(bytes).find((e) => /(^|\/)lines\.csv$/i.test(e.name));
  if (!entry) throw new Error('zip_unsupported');
  return decodeText(await readZipEntry(bytes, entry));
}
