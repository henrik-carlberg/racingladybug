// Autogiro (Bankgirot), filformat med 80 tecken per post. Ren logik.
// TK01 öppningspost, TK04 nytt medgivande, TK03 makulering, TK82 dragning. Återrapporten läses per TK82-post med statuskod.
// Kontrollera filerna i Bankgirots testtjänst innan första riktiga körningen.

const pad = (s: string | number, n: number, ch = ' ', left = false) => { const v = String(s).slice(0, n); return left ? v.padStart(n, ch) : v.padEnd(n, ch); };
const num = (s: string | number, n: number) => pad(String(s).replace(/\D/g, ''), n, '0', true);
const ymd = (d: string) => d.replace(/-/g, '');

export interface AgCompany { bankgiro: string; customerNo: string }
export interface AgMandate { payerNumber: string; clearing: string; account: string; idNumber: string }
export interface AgDraw { date: string; payerNumber: string; amount: number; reference: string }

function opening(c: AgCompany, date: string) {
  return '01' + ymd(date) + 'AUTOGIRO' + pad('', 44) + num(c.customerNo, 6) + num(c.bankgiro, 10) + pad('', 2);
}

/** Fil med nya medgivanden (TK04) och makuleringar (TK03) */
export function mandateFile(c: AgCompany, date: string, add: AgMandate[], cancel: string[] = []): string {
  const lines = [opening(c, date)];
  for (const m of add) lines.push('04' + num(c.bankgiro, 10) + num(m.payerNumber, 16) + num(m.clearing, 4) + num(m.account, 12) + num(m.idNumber, 12) + pad('', 24));
  for (const p of cancel) lines.push('03' + num(c.bankgiro, 10) + num(p, 16) + pad('', 52));
  return lines.map((l) => pad(l, 80)).join('\r\n') + '\r\n';
}

/** Fil med dragningar (TK82, engångsdragning) */
export function drawFile(c: AgCompany, date: string, draws: AgDraw[]): string {
  const lines = [opening(c, date)];
  for (const d of draws) {
    if (d.amount <= 0) throw new Error('Beloppet måste vara större än noll');
    lines.push('82' + ymd(d.date) + '0' + pad('', 3) + ' ' + num(d.payerNumber, 16) + num(d.amount, 12) + num(c.bankgiro, 10) + pad(d.reference, 16) + pad('', 11));
  }
  return lines.map((l) => pad(l, 80)).join('\r\n') + '\r\n';
}

export interface AgResult { payerNumber: string; amount: number; reference: string; date: string; ok: boolean; status: string }
const STATUS: Record<string, string> = { '0': 'Genomförd', '1': 'Täckning saknas', '2': 'Medgivande saknas', '9': 'Förnyad täckningskontroll' };

/** Återrapport: varje TK82-post med statuskod (sista tecknet). 0 = genomförd. */
export function parseResultFile(text: string): AgResult[] {
  return text.split(/\r?\n/).filter((l) => l.startsWith('82') && l.length >= 69).map((l) => {
    const code = l.length >= 80 ? l[79] : '0';
    return {
      date: `${l.slice(2, 6)}-${l.slice(6, 8)}-${l.slice(8, 10)}`, payerNumber: l.slice(15, 31).replace(/^0+/, ''), amount: Number(l.slice(31, 43)),
      reference: l.slice(53, 69).trim(), ok: code === '0' || code === ' ', status: STATUS[code === ' ' ? '0' : code] ?? `Kod ${code}`,
    };
  });
}

/** Första bankdag på eller efter datumet (lördag/söndag flyttas till måndag) */
export function bankDay(d: string): string {
  const x = new Date(d + 'T00:00:00Z');
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
