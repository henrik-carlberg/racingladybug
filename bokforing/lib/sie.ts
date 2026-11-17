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
