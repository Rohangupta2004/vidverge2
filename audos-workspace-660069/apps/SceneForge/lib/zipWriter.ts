// A minimal ZIP writer, used to package HyperFrames HTML/CSS/JS bundles in
// the browser.
//
// WHY NOT A LIBRARY. The only thing SceneForge needs to zip is a handful of
// small text files, and every byte of a CDN zip library would be downloaded
// by every customer who opens the studio. Entries are written with the STORE
// method (no compression), which is a fully valid ZIP and needs no deflate
// implementation at all — the bundles are a few kilobytes of markup, so the
// compression would have saved nothing worth a dependency.
//
// The output is byte-deterministic for the same input (a fixed timestamp is
// written rather than `Date.now()`), which is what lets lib/heygenFrames hash
// a bundle and know it has already been uploaded.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, e.g. 'index.html' or 'assets/app.js'. */
  name: string;
  text: string;
}

// A fixed DOS timestamp (1 Jan 2024, 00:00) keeps the archive reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

class ByteSink {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  u16(value: number) {
    const out = new Uint8Array(2);
    out[0] = value & 0xff;
    out[1] = (value >>> 8) & 0xff;
    this.push(out);
  }
  u32(value: number) {
    const out = new Uint8Array(4);
    out[0] = value & 0xff;
    out[1] = (value >>> 8) & 0xff;
    out[2] = (value >>> 16) & 0xff;
    out[3] = (value >>> 24) & 0xff;
    this.push(out);
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    this.chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.length; });
    return out;
  }
}

function utf8(value: string): Uint8Array {
  // TextEncoder is available in every browser the space runs in. The manual
  // fallback keeps the writer working if it is ever absent.
  const encoder = (window as any).TextEncoder ? new TextEncoder() : null;
  if (encoder) return encoder.encode(value);
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
}

/** Build a ZIP archive from a list of text files. */
export function createZip(entries: ZipEntry[]): Blob {
  const local = new ByteSink();
  const central = new ByteSink();
  let count = 0;

  entries.forEach((entry) => {
    const nameBytes = utf8(entry.name);
    const dataBytes = utf8(entry.text);
    const checksum = crc32(dataBytes);
    const offset = local.length;

    local.u32(0x04034b50);
    local.u16(20);
    local.u16(0x0800); // UTF-8 names
    local.u16(0); // stored
    local.u16(DOS_TIME);
    local.u16(DOS_DATE);
    local.u32(checksum);
    local.u32(dataBytes.length);
    local.u32(dataBytes.length);
    local.u16(nameBytes.length);
    local.u16(0);
    local.push(nameBytes);
    local.push(dataBytes);

    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(0x0800);
    central.u16(0);
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(checksum);
    central.u32(dataBytes.length);
    central.u32(dataBytes.length);
    central.u16(nameBytes.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.push(nameBytes);

    count += 1;
  });

  const localBytes = local.concat();
  const centralBytes = central.concat();
  const end = new ByteSink();
  end.u32(0x06054b50);
  end.u16(0);
  end.u16(0);
  end.u16(count);
  end.u16(count);
  end.u32(centralBytes.length);
  end.u32(localBytes.length);
  end.u16(0);

  return new Blob([localBytes, centralBytes, end.concat()], { type: 'application/zip' });
}

/** A short, stable fingerprint of a bundle's text content. */
export function bundleFingerprint(entries: ZipEntry[]): string {
  const joined = entries.map((entry) => `${entry.name}\u0000${entry.text}`).join('\u0001');
  return crc32(utf8(joined)).toString(16).padStart(8, '0');
}
