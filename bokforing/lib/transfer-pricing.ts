// Internprissättning: koncerninterna transaktioner, prismetod, marknadsmässighet och dokumentation. Belopp i öre.
export type TpType = 'goods' | 'services' | 'loan' | 'license' | 'other';
export type TpMethod = 'cup' | 'cost_plus' | 'resale_minus' | 'tnmm' | 'profit_split';
export const TYPE_LABEL: Record<TpType, string> = { goods: 'Varor', services: 'Tjänster', loan: 'Lån', license: 'Licenser och immateriella tillgångar', other: 'Övrigt' };
export const METHOD_LABEL: Record<TpMethod, string> = { cup: 'Jämförelseprismetoden (CUP)', cost_plus: 'Kostnadsplusmetoden', resale_minus: 'Återförsäljningsprismetoden', tnmm: 'Transaktionsbaserade nettovinstmetoden (TNMM)', profit_split: 'Vinstfördelningsmetoden' };
/** Transaktioner med en utländsk part under 5 miljoner kronor per år behöver inte dokumenteras (utom immateriella tillgångar) */
export const DOC_THRESHOLD = 500000000;
/** Stödtjänster med lågt mervärde: förenklat påslag 5 % (OECD) */
export const LOW_VALUE_MARKUP = 5;

export interface Tp { type: TpType; crossBorder: boolean; amount: number; method: TpMethod; markupPct: number | null; ratePct: number | null; rangeMin: number | null; rangeMax: number | null; documented: boolean; lowValue: boolean }
export interface Warning { level: 'error' | 'warn'; text: string }

export function needsDocumentation(t: Pick<Tp, 'crossBorder' | 'amount' | 'type'>) {
  return t.crossBorder && (t.type === 'license' || t.amount >= DOC_THRESHOLD);
}

export function checks(t: Tp): Warning[] {
  const w: Warning[] = [];
  if (needsDocumentation(t) && !t.documented) w.push({ level: 'error', text: 'Dokumentation saknas – krävs för gränsöverskridande transaktioner från 5 miljoner kronor per år och alltid för immateriella tillgångar' });
  const inRange = (v: number) => (t.rangeMin == null || v >= t.rangeMin) && (t.rangeMax == null || v <= t.rangeMax);
  if (t.type === 'loan') {
    if (t.ratePct == null) w.push({ level: 'warn', text: 'Ange räntan på lånet' });
    else if (!inRange(t.ratePct)) w.push({ level: 'error', text: `Räntan ${t.ratePct} % ligger utanför det marknadsmässiga intervallet` });
  }
  if (t.type === 'services' || t.method === 'cost_plus') {
    if (t.markupPct == null) w.push({ level: 'warn', text: 'Ange påslaget' });
    else if (t.lowValue && t.markupPct !== LOW_VALUE_MARKUP && (t.rangeMin == null && t.rangeMax == null)) w.push({ level: 'warn', text: `Stödtjänster med lågt mervärde har normalt ${LOW_VALUE_MARKUP} % påslag` });
    else if (!inRange(t.markupPct)) w.push({ level: 'error', text: `Påslaget ${t.markupPct} % ligger utanför det marknadsmässiga intervallet` });
    if (t.markupPct != null && t.markupPct <= 0) w.push({ level: 'error', text: 'Tjänster till närstående utan påslag är normalt inte marknadsmässiga' });
  }
  return w;
}
