import { requireCompany } from '@/lib/server/auth';
import { workspace } from '@/lib/services/audit-work';
import { workbook, XLSX_TYPE, kronor, type Cell } from '@/lib/xlsx';

const ST: Record<string, string> = { pending: 'Att granska', ok: 'Utan anmärkning', remark: 'Anmärkning' };

/** Granskningen som Excel (stickprov och kontrollpunkter) för revisorns eget system */
export async function GET(_req: Request, { params }: { params: Promise<{ cid: string; eid: string }> }) {
  const { cid, eid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  const w = await workspace(ctx, Number(eid)).catch(() => null);
  if (!w) return new Response('Saknas', { status: 404 });
  const h = (s: string) => ({ s, bold: true });
  const samples: Cell[][] = [[h('Verifikation'), h('Datum'), h('Text'), h('Belopp'), h('Underlag'), h('Urval'), h('Status'), h('Kommentar')],
    ...w.samples.map((s) => [s.label, s.date, s.text, kronor(s.amount), s.attachments, s.reason, ST[s.status], s.comment] as Cell[])];
  const cps: Cell[][] = [[h('Kontrollpunkt'), h('Saldo'), h('Status'), h('Kommentar')], ...w.checkpoints.map((c) => [c.title, c.balance == null ? null : kronor(c.balance), ST[c.status], c.comment] as Cell[])];
  const sum: Cell[][] = [[h(`${ctx.company.name} – revision ${w.start} – ${w.end}`)], [], ['Status', w.status === 'open' ? 'Pågår' : 'Avslutad'], ['Väsentlighet', kronor(w.materiality)],
    ['Stickprov', w.summary.samples.total], ['Anmärkningar', w.summary.samples.remark + w.summary.checkpoints.remark], [], ['Sammanfattning', w.conclusion]];
  const file = workbook([{ name: 'Sammanfattning', rows: sum, widths: [24, 60] }, { name: 'Stickprov', rows: samples, widths: [12, 12, 40, 14, 10, 28, 18, 40] }, { name: 'Kontrollpunkter', rows: cps, widths: [36, 16, 18, 60] }]);
  return new Response(new Uint8Array(file), { headers: { 'content-type': XLSX_TYPE, 'content-disposition': `attachment; filename="revision-${w.end.slice(0, 4)}.xlsx"`, 'cache-control': 'no-store' } });
}
