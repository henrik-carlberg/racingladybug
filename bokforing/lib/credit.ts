// Kreditkontroll och kundrisk (ren logik). Belopp i öre.
import type { Behavior } from './payment-forecast';

export type RiskClass = 'low' | 'medium' | 'high' | 'stop';
export const RISK_LABEL: Record<RiskClass, string> = { low: 'Låg risk', medium: 'Medelrisk', high: 'Hög risk', stop: 'Stoppa kredit' };

export interface CreditReport { score: number | null; remarks: number; status: string; recommendedLimit: number | null }

/**
 * Riskklass: kreditupplysningens score (0–100) och betalningsanmärkningar, justerad efter hur kunden betalat oss.
 * Konkurs, likvidation eller rekonstruktion ger alltid stopp.
 */
export function riskClass(r: CreditReport | null, b: Behavior | null): RiskClass {
  if (r && ['bankruptcy', 'liquidation', 'reconstruction', 'deregistered'].includes(r.status)) return 'stop';
  let level = !r || r.score == null ? 1 : r.score >= 70 ? 0 : r.score >= 40 ? 1 : 2;
  if (r && r.remarks > 0) level = Math.max(level, r.remarks >= 3 ? 3 : 2);
  if (b && b.count >= 3) {
    if (b.avgDelay > 30) level += 2;
    else if (b.avgDelay > 10) level += 1;
    else if (b.avgDelay <= 2 && b.onTimeShare >= 0.9 && level > 0) level -= 1;
  }
  return (['low', 'medium', 'high', 'stop'] as const)[Math.min(3, Math.max(0, level))];
}

export type Policy = 'warn' | 'block';

/** Kontroll innan en faktura bokförs: kreditgräns och riskklass */
export function creditDecision(o: { limit: number | null; open: number; amount: number; risk: RiskClass | null; policy: Policy }) {
  const after = o.open + o.amount;
  const reasons: string[] = [];
  if (o.risk === 'stop') reasons.push('kunden har riskklass Stoppa kredit');
  if (o.limit != null && after > o.limit) reasons.push(`kreditgränsen ${Math.round(o.limit / 100).toLocaleString('sv-SE')} kr överskrids (obetalt efter fakturan ${Math.round(after / 100).toLocaleString('sv-SE')} kr)`);
  return { ok: reasons.length === 0, block: reasons.length > 0 && o.policy === 'block', reasons, utilization: o.limit ? Math.round((after / o.limit) * 100) : null };
}

/** Föreslagen kreditgräns: upplysningens rekommendation, sänkt för sämre riskklass */
export function suggestedLimit(r: CreditReport | null, risk: RiskClass): number | null {
  if (!r?.recommendedLimit) return null;
  const f = { low: 1, medium: 0.7, high: 0.4, stop: 0 }[risk];
  return Math.round((r.recommendedLimit * f) / 100000) * 100000;
}

/** Sannolikhet att fakturan betalas i tid, för betalningsprognosen */
export const onTimeFactor = (risk: RiskClass | null) => ({ low: 0.97, medium: 0.9, high: 0.7, stop: 0.4 })[risk ?? 'medium'];
