import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createReceipt } from '@/lib/services/receipts';
import { parseAmount } from '@/lib/money';

/** Tar emot kvitton som fotades utan uppkoppling (skickas från telefonens kö) */
export async function POST(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return Response.json({ error: 'Fel ursprung' }, { status: 403 });
  const { cid } = await params;
  const actor = userActor(await requireCompany(cid));
  const fd = await req.formData();
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const f = fd.get('file');
  try {
    const total = parseAmount(s('total'));
    if (!total) throw new Error('Belopp saknas');
    const file = f instanceof File && f.size ? { filename: f.name, mimeType: f.type || 'application/octet-stream', data: Buffer.from(await f.arrayBuffer()) } : null;
    const v = await createReceipt(actor, { category: s('category'), total, vat_rate: s('vat_rate'), paid_with: s('paid_with'), date: s('date'), description: s('description'), persons: s('persons') }, file);
    return Response.json({ id: v.id }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Kvittot kunde inte bokföras' }, { status: 400 });
  }
}
