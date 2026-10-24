// ── A tiny store-only ZIP writer (pure) ──────────────────────────────────
//
// No compression (WAVs barely compress anyway), so it's just the headers and
// a CRC-32 per file: local header + data for each file, then the central
// directory, then the end record. Good for the voice dataset export without
// pulling in a zip library. Limits: < 4 GB, < 65k files (plenty here).

let table: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3, the one ZIP uses). */
export function crc32(data: Uint8Array): number {
  if (table === null) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the zip (forward slashes). */
  name: string;
  data: Uint8Array | string;
}

/** DOS date/time for the headers. */
function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date =
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time & 0xffff, date & 0xffff];
}

/** Files → the bytes of a .zip (stored, UTF-8 names). */
export function zipStore(entries: readonly ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const [time, date] = dosTime(when);
  const files = entries.map(e => {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { name, data, crc: crc32(data), offset: 0 };
  });
  let size = 22;
  for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  const head = (sig: number, f: (typeof files)[number], central: boolean) => {
    dv.setUint32(o, sig, true);
    o += 4;
    if (central) {
      dv.setUint16(o, 20, true); // made by
      o += 2;
    }
    dv.setUint16(o, 20, true); // version needed
    dv.setUint16(o + 2, 0x0800, true); // flags: UTF-8 names
    dv.setUint16(o + 4, 0, true); // stored
    dv.setUint16(o + 6, time, true);
    dv.setUint16(o + 8, date, true);
    dv.setUint32(o + 10, f.crc, true);
    dv.setUint32(o + 14, f.data.length, true);
    dv.setUint32(o + 18, f.data.length, true);
    dv.setUint16(o + 22, f.name.length, true);
    dv.setUint16(o + 24, 0, true); // extra
    o += 26;
    if (central) {
      dv.setUint16(o, 0, true); // comment
      dv.setUint16(o + 2, 0, true); // disk
      dv.setUint16(o + 4, 0, true); // internal attrs
      dv.setUint32(o + 6, 0, true); // external attrs
      dv.setUint32(o + 10, f.offset, true);
      o += 14;
    }
    out.set(f.name, o);
    o += f.name.length;
  };
  for (const f of files) {
    f.offset = o;
    head(0x04034b50, f, false);
    out.set(f.data, o);
    o += f.data.length;
  }
  const cdStart = o;
  for (const f of files) head(0x02014b50, f, true);
  const cdSize = o - cdStart;
  dv.setUint32(o, 0x06054b50, true);
  dv.setUint16(o + 4, 0, true);
  dv.setUint16(o + 6, 0, true);
  dv.setUint16(o + 8, files.length, true);
  dv.setUint16(o + 10, files.length, true);
  dv.setUint32(o + 12, cdSize, true);
  dv.setUint32(o + 16, cdStart, true);
  dv.setUint16(o + 20, 0, true);
  return out;
}
