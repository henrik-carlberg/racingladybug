'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { bookRevaluation } from '@/lib/services/fx-revaluation';

export async function revalue(cid: number, date: string, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && !k.startsWith('$')).map(([k, v]) => [k, String(v)]));
  const back = `/c/${cid}/bokslut/valuta?datum=${encodeURIComponent(date)}`;
  let r = { voucherId: 0, reversalId: null as number | null };
  await attempt(back, async () => { r = await bookRevaluation(a, date, input); });
  done(back, `Omvärderingen är bokförd${r.reversalId ? ' och kund- och leverantörsdelen återförs dagen efter' : ''}`);
}
