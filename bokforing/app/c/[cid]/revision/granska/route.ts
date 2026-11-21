import { requireCompany } from '@/lib/server/auth';
import { AppError } from '@/lib/errors';
import { parseAmount } from '@/lib/money';
import * as svc from '@/lib/services/audit-work';
import type { SampleMethod } from '@/lib/audit-work';

/**
 * Revisorns granskning (stickprov, kontrollpunkter, anmärkningar). Ett vanligt formulär-POST i stället för serveråtgärder:
 * revisorns konto spärras för alla serveråtgärder i bolaget, och granskningen ändrar ingenting i bokföringen.
 */
/** 303 så att webbläsaren hämtar sidan med GET efter formuläret */
const see = (path: string) => new Response(null, { status: 303, headers: { location: path } });

export async function POST(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  // Samma ursprung krävs (skydd mot förfalskade formulär från andra webbplatser)
  const origin = req.headers.get('origin'), host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return new Response('Fel ursprung', { status: 403 });
  const ctx = await requireCompany(cid, { auditWork: true });
  const fd = await req.formData();
  const g = (k: string) => String(fd.get(k) ?? '').trim();
  const num = (k: string) => (g(k) ? Number(g(k)) : undefined);
  const op = g('op'), eid = Number(g('eid'));
  const base = `/c/${ctx.company.id}/revision`;
  let back = eid ? `${base}/${eid}` : base, hash = '', msg = '';
  try {
    switch (op) {
      case 'start': back = `${base}/${(await svc.engagementFor(ctx, Number(g('fy')), true)).engagement!.id}`; break;
      case 'materiality': {
        const opt = (k: string) => (g(k) ? parseAmount(g(k)) ?? NaN : null);
        await svc.setMateriality(ctx, eid, parseAmount(g('materiality') || '0') ?? NaN, { performance: opt('performance'), trivial: opt('trivial'), basis: g('basis') });
        msg = 'Väsentligheten är sparad'; break;
      }
      case 'ledger_sample': {
        const kind = g('kind') === 'supplier' ? 'supplier' : 'customer';
        const m = g('method') === 'largest' ? 'largest' : g('method') === 'random' ? 'random' : 'mus';
        const r = await svc.addLedgerSample(ctx, eid, { kind, method: m, count: num('count') });
        msg = `${r.added} ${kind === 'customer' ? 'kundfakturor' : 'leverantörsfakturor'} lades till i stickprovet (av ${r.population} öppna poster)`; hash = '#reskontra'; break;
      }
      case 'ledger_review': await svc.reviewLedgerSample(ctx, eid, Number(g('sample')), g('status') as 'ok', g('comment')); hash = `#l${g('sample')}`; break;
      case 'sample': { const n = await svc.addSample(ctx, eid, { method: g('method') as SampleMethod, count: num('count'), from: num('from'), to: num('to'), userId: num('user_id') }); msg = `${n} verifikationer lades till i stickprovet`; break; }
      case 'review': await svc.reviewSample(ctx, eid, Number(g('sample')), g('status') as 'ok', g('comment')); hash = `#s${g('sample')}`; break;
      case 'checkpoint': await svc.reviewCheckpoint(ctx, eid, g('key'), g('status') as 'ok', g('comment')); hash = `#k-${g('key')}`; break;
      case 'send': { const n = await svc.sendRemarks(ctx, eid); msg = n ? `${n} anmärkningar är skickade till bolaget` : 'Inga nya anmärkningar att skicka'; break; }
      case 'close': await svc.closeEngagement(ctx, eid, g('conclusion')); msg = 'Granskningen är avslutad'; break;
      case 'report': await svc.issueReport(ctx, eid, { opinion: g('opinion'), basis: g('basis'), remarks: g('remarks'), adopt: g('adopt') === 'on', discharge: g('discharge') === 'on', place: g('place'), date: g('date') });
        msg = 'Revisionsberättelsen är signerad'; hash = '#revisionsberattelse'; break;
      default: return new Response('Okänd åtgärd', { status: 400 });
    }
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return see(`${back}?error=${encodeURIComponent(e.message)}${hash}`);
  }
  return see(`${back}${msg ? `?ok=${encodeURIComponent(msg)}` : ''}${hash}`);
}
