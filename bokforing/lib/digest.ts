// E-postsammandrag – ren logik (testbar)
export type DigestFreq = 'daily' | 'weekly' | 'off';
export interface DigestCompany { id: number; name: string; todos: { title: string; count: number; href: string; level: 'danger' | 'warn' | 'info' }[] }

/** Ska sammandraget skickas nu? Veckovis på måndagar, dagligen på vardagar; aldrig två gånger inom 20 timmar. */
export function digestDue(freq: DigestFreq, lastSent: Date | null, now: Date): boolean {
  if (freq === 'off') return false;
  if (lastSent && now.getTime() - lastSent.getTime() < 20 * 3600 * 1000) return false;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm', weekday: 'short' }).format(now);
  if (freq === 'weekly') return wd === 'Mon' || (!!lastSent && now.getTime() - lastSent.getTime() > 8 * 86400 * 1000);
  return !['Sat', 'Sun'].includes(wd);
}

/** Bygger sammandraget; null om det inte finns något brådskande att berätta */
export function buildDigest(o: { name: string; origin: string; companies: DigestCompany[]; unsubscribeUrl: string; freq: DigestFreq }): { subject: string; text: string } | null {
  const withWork = o.companies.map((c) => ({ ...c, todos: c.todos.filter((t) => t.level !== 'info' && t.count > 0) })).filter((c) => c.todos.length);
  if (!withWork.length) return null;
  const n = withWork.reduce((s, c) => s + c.todos.reduce((x, t) => x + t.count, 0), 0);
  const lines = [`Hej ${o.name.split(' ')[0] || ''}!`.replace(' !', '!'), '', `Det här väntar på dig${o.freq === 'weekly' ? ' den här veckan' : ' i dag'}:`, ''];
  for (const c of withWork) {
    lines.push(c.name);
    for (const t of c.todos) lines.push(`  ${t.level === 'danger' ? '!' : '•'} ${t.title}: ${o.origin}${t.href}`);
    lines.push('');
  }
  lines.push(`Öppna appen: ${o.origin}/`, '', `Du får det här ${o.freq === 'weekly' ? 'varje måndag' : 'varje vardag'}. Ändra under Mitt konto (${o.origin}/konto) eller avsluta direkt: ${o.unsubscribeUrl}`);
  return { subject: withWork.length === 1 ? `${n} saker väntar i ${withWork[0].name}` : `${n} saker väntar i dina bolag`, text: lines.join('\n') };
}
