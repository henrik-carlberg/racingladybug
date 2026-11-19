'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { confirmAsSignatory } from '@/lib/services/signatory';

export async function confirm(cid: number) {
  const a = userActor(await requireCompany(cid));
  const back = `/c/${cid}/installningar/verifiering`;
  let r = { verified: false, missing: 0 };
  await attempt(back, async () => { r = await confirmAsSignatory(a); });
  done(back, r.verified ? 'Bolaget är verifierat – Peppol och direktinlämning kan användas' : `Din bekräftelse är sparad. Firmateckningen kräver ${r.missing} till – be ${r.missing === 1 ? 'en annan ledamot' : 'andra ledamöter'} logga in med BankID och bekräfta här.`);
}
