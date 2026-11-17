// SIE typ 4 (verifikationer + saldon). Teckenkodning PC8 = IBM CP437.
import { toDecimalString } from './money';

export interface SieInput {
  companyName: string;
  orgnr: string;
  fiscalYear: { start: string; end: string }; // ÅÅÅÅ-MM-DD
  previousYear?: { start: string; end: string };
  accounts: { number: number; name: string }[];
  openingBalances: Map<number, number>; // öre, saldo (D−K) vid årets början för balanskonton
  closingBalances: Map<number, number>; // öre, UB för balanskonton
  results: Map<number, number>; // öre, årets saldo för resultatkonton
  vouchers: {
    series: string;
    number: number;
    date: string;
    description: string;
    created: string; // ÅÅÅÅ-MM-DD
    lines: { account: number; amount: number; description?: string }[]; // amount: D positiv, K negativ
  }[];
  programName?: string;
  generated?: Date;
}

const d8 = (iso: string) => iso.replace(/-/g, '').slice(0, 8);

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ') + '"';
}

export function buildSie4(input: SieInput): string {
  const out: string[] = [];
  const gen = input.generated ?? new Date();
  out.push('#FLAGGA 0');
  out.push(`#PROGRAM ${quote(input.programName ?? 'Bokforing')} 1.0`);
  out.push('#FORMAT PC8');
  out.push(`#GEN ${d8(gen.toISOString())}`);
  out.push('#SIETYP 4');
  out.push(`#ORGNR ${input.orgnr}`);
  out.push(`#FNAMN ${quote(input.companyName)}`);
  out.push(`#RAR 0 ${d8(input.fiscalYear.start)} ${d8(input.fiscalYear.end)}`);
  if (input.previousYear) out.push(`#RAR -1 ${d8(input.previousYear.start)} ${d8(input.previousYear.end)}`);
  out.push('#KPTYP BAS2014');
  for (const a of [...input.accounts].sort((x, y) => x.number - y.number)) {
    out.push(`#KONTO ${a.number} ${quote(a.name)}`);
    const t = a.number < 2000 ? 'T' : a.number < 3000 ? 'S' : a.number < 4000 ? 'I' : 'K';
    out.push(`#KTYP ${a.number} ${t}`);
  }
  const sorted = (m: Map<number, number>) => [...m].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  for (const [n, v] of sorted(input.openingBalances)) out.push(`#IB 0 ${n} ${toDecimalString(v)}`);
  for (const [n, v] of sorted(input.closingBalances)) out.push(`#UB 0 ${n} ${toDecimalString(v)}`);
  for (const [n, v] of sorted(input.results)) out.push(`#RES 0 ${n} ${toDecimalString(v)}`);
  for (const v of input.vouchers) {
    out.push(`#VER ${quote(v.series)} ${v.number} ${d8(v.date)} ${quote(v.description)} ${d8(v.created)}`);
    out.push('{');
    for (const l of v.lines) {
      out.push(`   #TRANS ${l.account} {} ${toDecimalString(l.amount)}${l.description ? ` "" ${quote(l.description)}` : ''}`);
    }
    out.push('}');
  }
  return out.join('\r\n') + '\r\n';
}

// Unicode → CP437 för de tecken som förekommer i svensk text
const CP437: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '¢': 0x9b, '£': 0x9c, '¥': 0x9d, 'á': 0xa0, 'í': 0xa1,
  'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, '§': 0x15, '½': 0xab, '¼': 0xac, '«': 0xae, '»': 0xaf,
  'ß': 0xe1, 'µ': 0xe6, '±': 0xf1, '°': 0xf8, '\u00a0': 0xff,
};

export function encodeCp437(s: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else bytes.push(CP437[ch] ?? 0x3f); // '?' för tecken som saknas
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------------------------
// Inläsning av SIE (typ 1–4). Filen är normalt PC8 (CP437) men UTF-8 och Latin-1 förekommer.

const CP437_DECODE: Record<number, string> = Object.fromEntries(Object.entries(CP437).map(([ch, b]) => [b, ch]));

/** Avkodar en SIE-fil: UTF-8 om den är giltig och innehåller åäö som UTF-8, annars CP437 (#FORMAT PC8) eller Latin-1 */
export function decodeSie(bytes: Uint8Array): string {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\u0080-￿]/.test(s)) return s.replace(/^﻿/, '');
  } catch { /* inte UTF-8 */ }
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4000));
  const pc8 = /#FORMAT\s+PC8/i.test(head) || !/#FORMAT/i.test(head);
  if (!pc8) return new TextDecoder('latin1').decode(bytes);
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_DECODE[b] ?? '?';
  return out;
}

/** Delar en rad i fält: citerade strängar med \" och \\, objektlistor {…} som ett fält */
export function sieTokens(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let s = ''; i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) { s += line[i + 1]; i += 2; } else s += line[i++];
      }
      i++; out.push(s);
    } else if (c === '{') {
      const end = line.indexOf('}', i);
      const stop = end < 0 ? line.length : end + 1;
      out.push(line.slice(i, stop)); i = stop;
    } else {
      let s = '';
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') s += line[i++];
      out.push(s);
    }
  }
  return out;
}

/** "1234.5", "-12,30", "1 000.00" → öre */
export function sieAmount(s: string): number {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) throw new Error(`Ogiltigt belopp: ${s}`);
  const neg = t.startsWith('-');
  const [int, dec = ''] = t.replace('-', '').split('.');
  const v = Number(int) * 100 + Number((dec + '00').slice(0, 2));
  return neg ? -v : v;
}

const iso = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');

export interface SieFile {
  companyName: string;
  orgnr: string;
  sieType: number;
  program: string;
  years: Record<number, { start: string; end: string }>; // 0 = innevarande, -1 = föregående
  accounts: { number: number; name: string }[];
  openingBalances: Record<number, Record<number, number>>; // år → konto → öre (D−K)
  closingBalances: Record<number, Record<number, number>>;
  results: Record<number, Record<number, number>>;
  vouchers: { series: string; number: string; date: string; description: string; lines: { account: number; amount: number; description: string }[] }[];
  warnings: string[];
}

export function parseSie(text: string): SieFile {
  const f: SieFile = { companyName: '', orgnr: '', sieType: 0, program: '', years: {}, accounts: [], openingBalances: {}, closingBalances: {}, results: {}, vouchers: [], warnings: [] };
  const lines = text.split(/\r?\n/);
  let ver: SieFile['vouchers'][number] | null = null;
  const put = (m: Record<number, Record<number, number>>, y: string, acc: string, amt: string) => {
    const year = Number(y); const a = Number(acc);
    if (!Number.isInteger(year) || !Number.isInteger(a)) return;
    (m[year] ??= {})[a] = (m[year][a] ?? 0) + sieAmount(amt);
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n].trim();
    if (!raw) continue;
    if (raw === '{') continue;
    if (raw === '}') { if (ver) f.vouchers.push(ver); ver = null; continue; }
    if (!raw.startsWith('#')) continue;
    const [tag, ...a] = sieTokens(raw);
    try {
      switch (tag.toUpperCase()) {
        case '#FNAMN': f.companyName = a[0] ?? ''; break;
        case '#ORGNR': f.orgnr = a[0] ?? ''; break;
        case '#SIETYP': f.sieType = Number(a[0]) || 0; break;
        case '#PROGRAM': f.program = a.join(' '); break;
        case '#RAR': if (iso(a[1]) && iso(a[2])) f.years[Number(a[0])] = { start: iso(a[1]), end: iso(a[2]) }; break;
        case '#KONTO': if (/^\d{4}$/.test(a[0])) f.accounts.push({ number: Number(a[0]), name: a[1] ?? '' }); break;
        case '#IB': put(f.openingBalances, a[0], a[1], a[2]); break;
        case '#UB': put(f.closingBalances, a[0], a[1], a[2]); break;
        case '#RES': put(f.results, a[0], a[1], a[2]); break;
        case '#VER':
          if (ver) f.vouchers.push(ver);
          ver = { series: a[0] || 'A', number: a[1] ?? '', date: iso(a[2]), description: a[3] ?? '', lines: [] };
          break;
        case '#TRANS':
          if (!ver) break;
          // #TRANS kontonr {objektlista} belopp [transdat] [transtext] [kvantitet] [sign]
          ver.lines.push({ account: Number(a[0]), amount: sieAmount(a[2]), description: a[4] ?? '' });
          break;
        // #RTRANS/#BTRANS (tillagda/borttagna rader) följs av en #TRANS – de räknas inte
      }
    } catch (e) {
      f.warnings.push(`Rad ${n + 1}: ${(e as Error).message}`);
    }
  }
  if (ver) f.vouchers.push(ver);
  return f;
}

/** Kontroller inför import: obalanserade verifikationer, saknade datum, konton utanför kontoplanen */
export function sieProblems(f: SieFile): string[] {
  const p: string[] = [];
  if (!f.years[0]) p.push('Filen saknar räkenskapsår (#RAR 0)');
  for (const v of f.vouchers) {
    const id = `${v.series}${v.number}`;
    if (!v.date) p.push(`Verifikation ${id} saknar datum`);
    const sum = v.lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0) p.push(`Verifikation ${id} balanserar inte (${toDecimalString(sum)})`);
    if (f.years[0] && v.date && (v.date < f.years[0].start || v.date > f.years[0].end)) p.push(`Verifikation ${id} (${v.date}) ligger utanför räkenskapsåret`);
    const bad = v.lines.filter((l) => !(l.account >= 1000 && l.account <= 9999));
    if (bad.length) p.push(`Verifikation ${id} har ogiltigt konto ${bad[0].account}`);
  }
  const ib = Object.entries(f.openingBalances[0] ?? {}).filter(([a]) => Number(a) < 3000);
  const ibSum = ib.reduce((s, [, v]) => s + v, 0);
  if (ibSum !== 0) p.push(`Ingående balanser går inte jämnt ut (differens ${toDecimalString(ibSum)})`);
  return p;
}
