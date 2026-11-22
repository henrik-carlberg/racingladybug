'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import { assess, bookReserve } from '@/lib/services/bad-debts';

export async function reserveAction(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/bokslut/${fy}/kundforluster`;
  let change = 0;
  await attempt(back, async () => { change = (await bookReserve(actor, fy)).change; });
  done(back, change > 0 ? `Reserven för befarade kundförluster är ökad med ${kr(change)} kr` : `Reserven är minskad med ${kr(-change)} kr`);
}

export async function assessAction(cid: number, fy: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/bokslut/${fy}/kundforluster`;
  let pct: number | null = null;
  await attempt(back, async () => { pct = await assess(actor, invoiceId, { pct: String(fd.get('pct') ?? ''), note: String(fd.get('note') ?? '') }); });
  done(back, pct == null ? 'Bedömningen är borttagen – schablonen gäller' : `Fakturan är bedömd: ${pct} % befaras gå förlorad`);
}
