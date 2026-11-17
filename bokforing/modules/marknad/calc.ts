// Marknadsföring: nyckeltal utan databas. Belopp i öre.

export const CHANNELS: Record<string, string> = {
  google: 'Google Ads', meta: 'Meta (Facebook/Instagram)', linkedin: 'LinkedIn', email: 'E-postutskick', seo: 'Webb och SEO',
  event: 'Mässa och event', print: 'Tryck och annonser', partner: 'Partner och rekommendation', other: 'Övrigt',
};

export const LEAD_STATUS: Record<string, string> = { new: 'Ny', contacted: 'Kontaktad', qualified: 'Kvalificerad', won: 'Kund', lost: 'Förlorad' };

export interface CampaignMetrics { cpl: number | null; cpa: number | null; conversion: number | null; roi: number | null; budgetUsed: number | null }

/**
 * cpl = kostnad per lead, cpa = kostnad per vunnen kund, conversion = andel leads som blivit kunder (%),
 * roi = (intäkter − kostnad) / kostnad (%), budgetUsed = kostnad av budget (%)
 */
export function campaignMetrics(m: { budget: number; cost: number; leads: number; won: number; revenue: number }): CampaignMetrics {
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    cpl: m.leads ? Math.round(m.cost / m.leads) : null,
    cpa: m.won ? Math.round(m.cost / m.won) : null,
    conversion: pct(m.won, m.leads),
    roi: m.cost ? Math.round(((m.revenue - m.cost) / m.cost) * 1000) / 10 : null,
    budgetUsed: pct(m.cost, m.budget),
  };
}

/** Tratt: antal per status, där senare steg räknas in i tidigare (en kund har också varit kontaktad) */
export function funnel(counts: Record<string, number>) {
  const won = counts.won ?? 0, q = (counts.qualified ?? 0) + won, c = (counts.contacted ?? 0) + q;
  const total = c + (counts.new ?? 0) + (counts.lost ?? 0);
  return [
    { key: 'total', label: 'Leads', n: total }, { key: 'contacted', label: 'Kontaktade', n: c },
    { key: 'qualified', label: 'Kvalificerade', n: q }, { key: 'won', label: 'Kunder', n: won },
  ];
}

/** Leads som ska gallras enligt GDPR: förlorade eller utan samtycke och utan aktivitet på `months` månader */
export function shouldPurge(l: { status: string; consent: boolean; updated: string; customer_id: number | null }, today: string, months = 24): boolean {
  if (l.customer_id || l.status === 'won') return false;
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return l.updated < d.toISOString().slice(0, 10) && (l.status === 'lost' || !l.consent);
}
