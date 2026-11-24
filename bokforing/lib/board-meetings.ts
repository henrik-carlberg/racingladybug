// Styrelsemöten och bolagsstämmor (aktiebolagslagen)
export const KINDS = { board: 'Styrelsemöte', agm: 'Årsstämma', egm: 'Extra bolagsstämma' } as const;
export type MeetingKind = keyof typeof KINDS;

export const TEMPLATES = {
  open: 'Mötets öppnande',
  chair: 'Val av ordförande och protokollförare',
  adjuster: 'Val av justerare',
  agenda: 'Godkännande av dagordning',
  report: 'Ekonomisk rapport',
  annual_report: 'Fastställande av resultaträkning och balansräkning',
  dividend: 'Disposition av bolagets vinst (utdelning)',
  discharge: 'Ansvarsfrihet för styrelseledamöter och verkställande direktör',
  election: 'Val av styrelse och revisor samt arvoden',
  signatory: 'Firmateckning',
  investment: 'Investeringsbeslut',
  other: 'Övrig fråga',
  close: 'Mötets avslutande',
} as const;
export type Template = keyof typeof TEMPLATES;

/** Standarddagordning; årsstämman ska besluta om fastställelse, vinstdisposition och ansvarsfrihet (ABL 7 kap. 11 §) */
export function defaultAgenda(kind: MeetingKind): Template[] {
  if (kind === 'agm') return ['open', 'chair', 'adjuster', 'agenda', 'annual_report', 'dividend', 'discharge', 'election', 'close'];
  if (kind === 'egm') return ['open', 'chair', 'adjuster', 'agenda', 'other', 'close'];
  return ['open', 'adjuster', 'agenda', 'report', 'close'];
}
/** Årsstämman som inte har de obligatoriska punkterna */
export const missingAgmItems = (templates: string[]) => (['annual_report', 'dividend', 'discharge'] as const).filter((t) => !templates.includes(t));

/** Styrelsen är beslutför när mer än hälften av ledamöterna är närvarande (ABL 8 kap. 21 §); suppleanter räknas inte här */
export function quorum(members: string[], present: string[]) {
  const norm = (s: string) => s.trim().toLowerCase();
  const p = new Set(present.map(norm));
  const here = members.filter((m) => p.has(norm(m))).length;
  const needed = Math.floor(members.length / 2) + 1;
  return { members: members.length, here, needed, ok: members.length === 0 || here >= needed };
}

/** Beslut att följa upp: har ansvarig eller sista dag och är inte klarmarkerade */
export function followUp<T extends { decision: string; owner: string; due_date: string | null; done_on: string | null }>(items: T[], today: string) {
  return items.filter((i) => i.decision && !i.done_on && (i.owner || i.due_date)).map((i) => ({ ...i, overdue: !!i.due_date && i.due_date < today }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function minutesHtml(co: { name: string; orgnr: string }, m: { kind: MeetingKind; date: string; place: string; chair: string; secretary: string; present: string[] }, items: { title: string; decision: string; owner: string; due_date: string | null }[]) {
  return `<h1>Protokoll fört vid ${esc(KINDS[m.kind].toLowerCase())}</h1><p>${esc(co.name)} (${esc(co.orgnr)}) · ${esc(m.date)}${m.place ? ` · ${esc(m.place)}` : ''}</p>
<p><b>Närvarande:</b> ${esc(m.present.join(', '))}</p>${m.chair ? `<p><b>Ordförande:</b> ${esc(m.chair)}${m.secretary ? ` · <b>Protokollförare:</b> ${esc(m.secretary)}` : ''}</p>` : ''}
<ol>${items.map((i) => `<li><b>${esc(i.title)}</b>${i.decision ? `<br>Beslut: ${esc(i.decision)}` : ''}${i.owner ? `<br>Ansvarig: ${esc(i.owner)}${i.due_date ? `, senast ${esc(i.due_date)}` : ''}` : ''}</li>`).join('')}</ol><p>Vid protokollet / Justeras:</p>`;
}
