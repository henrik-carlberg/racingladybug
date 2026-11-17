// Belopp hanteras i öre (heltal) överallt.

/** Tolkar "1 234,50", "1234.5", "-12" → öre. Returnerar null om ogiltigt. */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s ]/g, '').replace(/kr$/i, '');
  if (s === '') return null;
  // Tillåt både komma och punkt som decimaltecken
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [kr, ore = ''] = s.replace('-', '').split('.');
  const v = Number(kr) * 100 + Number((ore + '00').slice(0, 2));
  return neg ? -v : v;
}

/** öre → "1 234,50" */
export function formatAmount(ore: number, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  const neg = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100);
  const rest = abs % 100;
  const krStr = kr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = decimals ? `${krStr},${rest.toString().padStart(2, '0')}` : krStr;
  return neg ? `-${s}` : s;
}

/** öre → "1234.50" (punkt, utan tusentalsavgränsare) för filexport */
export function toDecimalString(ore: number): string {
  const neg = ore < 0;
  const abs = Math.abs(ore);
  const s = `${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Avrunda öre till närmaste hela krona (halva uppåt) */
export function roundToKrona(ore: number): number {
  return Math.round(ore / 100) * 100;
}

/** Procentsats av belopp, avrundat till närmaste öre */
export function percentOf(ore: number, percent: number): number {
  return Math.round((ore * percent) / 100);
}
