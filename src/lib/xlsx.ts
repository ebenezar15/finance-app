/**
 * Minimal, dependency-free .xlsx reader: enough to turn the first worksheet of an exported
 * spreadsheet (CashBook, banks, Google Sheets) into rows of strings. Runs fully on-device.
 *
 * An .xlsx file is a zip of XML parts. We read the zip's central directory, inflate the parts we
 * need with the platform's DecompressionStream('deflate-raw'), then read shared strings and the
 * first sheet's cells. Numbers stay as their raw text (Excel date serials are converted by the
 * caller, which knows which column holds dates).
 */

interface ZipEntry { name: string; method: number; compSize: number; offset: number }

function readZipDirectory(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file isn’t a valid Excel (.xlsx) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nameLen = dv.getUint16(e.offset + 26, true);
  const extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('This spreadsheet uses a compression format the app can’t read. Save it again as .xlsx or CSV.');
  const stream = new Response(data as unknown as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Reads the first worksheet (in workbook order) into a grid of strings. */
export async function readXlsx(file: Blob): Promise<string[][]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new Error('This is an old-style .xls file. In CashBook (or Excel) export as .xlsx or CSV instead.');
  }
  const entries = readZipDirectory(buf);
  const find = (name: string) => entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

  // Shared strings (most text cells point into this table).
  const shared: string[] = [];
  const ss = find('xl/sharedStrings.xml');
  if (ss) {
    const doc = parse(await readEntry(buf, ss));
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }

  // First sheet in workbook order, resolved through the workbook relationships.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = find('xl/workbook.xml');
  const rels = find('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const firstSheet = parse(await readEntry(buf, wb)).getElementsByTagName('sheet')[0];
    const rid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = Array.from(parse(await readEntry(buf, rels)).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = find(sheetPath) ?? entries.find((e) => /^xl\/worksheets\/[^/]+\.xml$/i.test(e.name));
  if (!sheet) throw new Error('No worksheet found in this file.');

  const doc = parse(await readEntry(buf, sheet));
  const rows: string[][] = [];
  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const out: string[] = [];
    let next = 0;
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text: string;
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
      else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = v;
      while (out.length < i) out.push('');
      out[i] = text.trim();
    }
    if (out.some((x) => x)) rows.push(out);
  }
  return rows;
}

/** Excel stores dates as days since 1899-12-30 (with the 1900 leap-year quirk built in). */
export function excelSerialToDate(serial: number): Date {
  const ms = Math.round((serial - 25569) * 86400_000);
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}
