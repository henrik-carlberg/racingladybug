import { companyForCalendar, wheelItems } from '@/lib/services/wheel';
import { icsCalendar, addDaysIso, WHEEL_MODULES } from '@/lib/wheel';
import { today } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Årshjulet som kalender (iCal) för Outlook, Google och Apple. Länken är personlig och slutar gälla om användaren lämnar bolaget. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const c = await companyForCalendar(token);
  if (!c) return new Response('Okänd kalender', { status: 404 });
  const t = today();
  const items = await wheelItems(c.company_id, addDaysIso(t, -60), addDaysIso(t, 400));
  const label = Object.fromEntries(WHEEL_MODULES.map((m) => [m.key, m.label]));
  return new Response(icsCalendar(`Årshjul ${c.name}`, items.map((i) => ({ key: `${c.company_id}:${i.key}`, date: i.date, title: `${i.title} (${label[i.module]})`, done: i.done }))), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'inline; filename="arshjul.ics"' },
  });
}
