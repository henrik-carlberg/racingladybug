// Kontinuitetsplan: vem kan göra vad, ensamberoenden och saknade ersättare.
import { PERMISSIONS, hasPermission, type Permission } from '@/lib/permissions';

export type Member = { id: number; name: string; role: string; permissions: string[] | null };
export type Task = { id: number; name: string; permission: Permission | null; responsible_id: number | null; substitute_id: number | null };
export type Finding = { key: string; level: 'danger' | 'warn'; text: string };

export const STANDARD_TASKS: { name: string; permission: Permission }[] = [
  { name: 'Betala leverantörer och löner', permission: 'payments' },
  { name: 'Köra lönen', permission: 'payroll' },
  { name: 'Fakturera kunder', permission: 'invoicing' },
  { name: 'Attestera leverantörsfakturor', permission: 'attest' },
  { name: 'Bokföring, moms och arbetsgivardeklaration', permission: 'ledger' },
];

export function analyse(members: Member[], tasks: Task[], powers: { name: string; counterparty: string; holder: string }[]) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const can = (id: number | null, p: Permission | null) => { const m = id == null ? null : byId.get(id); return !!m && (p == null || hasPermission(m.role, m.permissions, p)); };
  const tasksOut = tasks.map((t) => {
    const f: Finding[] = [];
    const resp = t.responsible_id == null ? null : byId.get(t.responsible_id), sub = t.substitute_id == null ? null : byId.get(t.substitute_id);
    if (!resp) f.push({ key: 'no_responsible', level: 'danger', text: t.responsible_id == null ? 'Ingen ansvarig' : 'Den ansvariga har inte längre tillgång till bolaget' });
    else if (!can(resp.id, t.permission)) f.push({ key: 'responsible_perm', level: 'danger', text: `${resp.name} saknar behörigheten ”${PERMISSIONS[t.permission!]}”` });
    if (!sub) f.push({ key: 'no_substitute', level: 'danger', text: t.substitute_id == null ? 'Ingen ersättare' : 'Ersättaren har inte längre tillgång till bolaget' });
    else if (sub.id === resp?.id) f.push({ key: 'same_person', level: 'danger', text: 'Ersättaren är samma person som den ansvariga' });
    else if (!can(sub.id, t.permission)) f.push({ key: 'substitute_perm', level: 'warn', text: `Ersättaren ${sub.name} saknar behörigheten ”${PERMISSIONS[t.permission!]}” – ge behörigheten under Användare` });
    return { ...t, responsible: resp?.name ?? null, substitute: sub?.name ?? null, findings: f };
  });
  const active = members.filter((m) => m.role !== 'auditor' && m.role !== 'employee');
  const single = (Object.keys(PERMISSIONS) as Permission[]).map((p) => ({ permission: p, label: PERMISSIONS[p], holders: active.filter((m) => hasPermission(m.role, m.permissions, p)).map((m) => m.name) }))
    .filter((x) => x.holders.length <= 1);
  const byParty = new Map<string, { counterparty: string; holders: Set<string>; names: string[] }>();
  for (const p of powers) {
    const k = (p.counterparty || p.name).trim().toLowerCase();
    const e = byParty.get(k) ?? { counterparty: p.counterparty || p.name, holders: new Set<string>(), names: [] };
    if (p.holder.trim()) e.holders.add(p.holder.trim()); e.names.push(p.name); byParty.set(k, e);
  }
  const powerSingles = [...byParty.values()].filter((e) => e.holders.size <= 1).map((e) => ({ counterparty: e.counterparty, holder: [...e.holders][0] ?? '', names: e.names }));
  const count = tasksOut.reduce((a, t) => a + t.findings.length, 0) + single.length + powerSingles.length;
  return { tasks: tasksOut, single, powerSingles, count };
}

export const reviewDue = (reviewedOn: string | null, today: string) => !reviewedOn || Date.parse(today) - Date.parse(reviewedOn) > 365 * 864e5;
