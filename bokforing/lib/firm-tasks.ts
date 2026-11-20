// Byråns arbetstavla (ren logik): bolagens deadlines och byråns egna uppgifter i en lista med ansvarig och status.
export interface BoardDeadline { companyId: number; company: string; key: string; title: string; due: string; status: 'done' | 'overdue' | 'soon' | 'upcoming'; href: string }
export interface BoardTask { id: number; companyId: number; deadlineKey: string | null; title: string; due: string; assignee: number | null; assigneeName: string | null; status: 'open' | 'done' }
export interface BoardRow { companyId: number; company: string; title: string; due: string; state: 'overdue' | 'soon' | 'upcoming' | 'done'; assignee: number | null; assigneeName: string | null;
  taskId: number | null; deadlineKey: string | null; href: string | null; kind: 'deadline' | 'task' }

const stateOf = (due: string, today: string, done: boolean, soonDays = 14): BoardRow['state'] => {
  if (done) return 'done';
  if (due < today) return 'overdue';
  const soon = new Date(Date.parse(today) + soonDays * 864e5).toISOString().slice(0, 10);
  return due <= soon ? 'soon' : 'upcoming';
};

/** Slår ihop deadlines och uppgifter; en deadline som har en uppgift visar uppgiftens ansvarige och status */
export function board(deadlines: BoardDeadline[], tasks: BoardTask[], today: string, o: { assignee?: number | null; companyId?: number | null; showDone?: boolean } = {}) {
  const byKey = new Map(tasks.filter((t) => t.deadlineKey).map((t) => [`${t.companyId}:${t.deadlineKey}`, t]));
  const rows: BoardRow[] = deadlines.map((d) => {
    const t = byKey.get(`${d.companyId}:${d.key}`);
    const done = d.status === 'done' || t?.status === 'done';
    return { companyId: d.companyId, company: d.company, title: d.title, due: d.due, state: stateOf(d.due, today, done), assignee: t?.assignee ?? null, assigneeName: t?.assigneeName ?? null,
      taskId: t?.id ?? null, deadlineKey: d.key, href: d.href, kind: 'deadline' };
  });
  const company = new Map(deadlines.map((d) => [d.companyId, d.company]));
  for (const t of tasks) if (!t.deadlineKey) rows.push({ companyId: t.companyId, company: company.get(t.companyId) ?? '', title: t.title, due: t.due, state: stateOf(t.due, today, t.status === 'done'),
    assignee: t.assignee, assigneeName: t.assigneeName, taskId: t.id, deadlineKey: null, href: null, kind: 'task' });
  const order = { overdue: 0, soon: 1, upcoming: 2, done: 3 };
  return rows
    .filter((r) => (o.showDone || r.state !== 'done') && (o.assignee == null || r.assignee === o.assignee) && (o.companyId == null || r.companyId === o.companyId))
    .sort((a, b) => order[a.state] - order[b.state] || a.due.localeCompare(b.due) || a.company.localeCompare(b.company));
}

export function summary(rows: BoardRow[]) {
  return { overdue: rows.filter((r) => r.state === 'overdue').length, soon: rows.filter((r) => r.state === 'soon').length, unassigned: rows.filter((r) => r.state !== 'done' && !r.assignee).length };
}
