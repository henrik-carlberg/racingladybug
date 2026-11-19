// Text ur underlag för sökning: PDF:er med textlager, text-, CSV-, XML- och JSON-filer. Bilder läses med OCR separat. Ren logik.
import { inflateSync } from 'node:zlib';

const MAX = 200_000;
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX);

/** PDF-strängar: (literal) med escapes och <hex> */
function pdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[e] ?? String.fromCharCode(parseInt(e, 8)));
}
const hexString = (h: string) => {
  const b = Buffer.from(h.replace(/\s/g, '').padEnd(h.replace(/\s/g, '').length + (h.replace(/\s/g, '').length % 2), '0'), 'hex');
  // UTF-16BE med BOM, annars ett tecken per byte
  return b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('latin1');
};

/** Textoperatorer i ett innehållsflöde: Tj, TJ, ' och " – radbrytning vid Td/TD/T* och ET */
export function pdfContentText(content: string): string {
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|\[|\]|T\*|Td|TD|Tj|TJ|ET|'|"/g;
  let buf: string[] = [];
  for (const m of content.matchAll(re)) {
    const t = m[0];
    if (t[0] === '(') buf.push(pdfString(t.slice(1, -1)));
    else if (t[0] === '<') buf.push(hexString(t.slice(1, -1)));
    else if (t === 'Tj' || t === 'TJ' || t === "'" || t === '"') { out.push(buf.join('')); buf = []; }
    else if (t === 'Td' || t === 'TD' || t === 'T*' || t === 'ET') { out.push('\n'); buf = []; }
  }
  return out.join('').replace(/\n+/g, '\n');
}

export function pdfText(data: Buffer): string {
  const s = data.toString('latin1');
  const parts: string[] = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    let raw = data.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) { try { raw = inflateSync(raw); } catch { continue; } }
    else if (/\/Filter/.test(m[1])) continue; // bilder och andra kodningar
    const c = raw.toString('latin1');
    if (/\bBT\b/.test(c)) parts.push(pdfContentText(c));
    re.lastIndex = end;
  }
  return clean(parts.join('\n'));
}

export function documentText(mime: string, filename: string, data: Buffer): string | null {
  const m = mime.toLowerCase(), f = filename.toLowerCase();
  if (m === 'application/pdf' || f.endsWith('.pdf')) return pdfText(data);
  if (m.startsWith('text/') || /\.(txt|csv|xml|json|se|si|sie)$/.test(f) || m.includes('xml') || m === 'application/json') {
    const t = data.toString('utf8');
    return clean(m.includes('xml') || f.endsWith('.xml') ? t.replace(/<[^>]+>/g, ' ') : t);
  }
  return null; // bild: OCR
}

/** Sökfrågan: ord för fulltext och ett belopp om frågan ser ut som ett (”1 250,50” → 125050 öre) */
export function parseQuery(q: string) {
  const s = q.trim().slice(0, 200);
  const amt = /^-?\d{1,3}(?:[  ]?\d{3})*(?:[,.]\d{1,2})?$/.test(s) ? Math.round(Number(s.replace(/[  ]/g, '').replace(',', '.')) * 100) : null;
  return { text: s, amount: amt != null && Number.isFinite(amt) && amt !== 0 ? amt : null, number: /^\d{1,12}$/.test(s) ? s : null };
}

/** Bokföringslagen 7 kap. 2 §: räkenskapsinformation sparas till och med det sjunde året efter utgången av det kalenderår då räkenskapsåret avslutades */
export const retentionUntil = (fyEnd: string) => `${Number(fyEnd.slice(0, 4)) + 7}-12-31`;

/** Taggar: små bokstäver, bindestreck, högst 30 tecken */
export function normalizeTag(t: string) {
  const s = t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9åäö\-]/g, '').slice(0, 30);
  return s.length >= 2 ? s : null;
}

/** tsquery med prefixsökning: ”kontor hyr” → kontor:* & hyr:* (bara bokstäver och siffror släpps igenom) */
export function prefixQuery(q: string): string | null {
  const words = q.toLowerCase().split(/[^a-z0-9åäöéü]+/).filter((w) => w.length >= 2).slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}
/** ts_headline-markeringar [[…]] → delar för visning */
export function highlightParts(s: string): { text: string; hit: boolean }[] {
  return s.split(/(\[\[.*?\]\])/).filter(Boolean).map((p) => (p.startsWith('[[') ? { text: p.slice(2, -2), hit: true } : { text: p, hit: false }));
}
