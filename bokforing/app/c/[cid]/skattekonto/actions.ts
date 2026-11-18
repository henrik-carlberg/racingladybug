'use server';
import { attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { decodeCsv } from '@/lib/csv-import';
import * as svc from '@/lib/services/taxaccount';

const back = (cid: number) => `/c/${cid}/skattekonto`;

export async function importFile(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let msg = '';
  await attempt(back(cid), async () => {
    const f = await fileFrom(fd);
    const text = f ? decodeCsv(new Uint8Array(f.data)) : str(fd, 'text');
    if (!text.trim()) throw new Error('Välj en fil eller klistra in transaktionerna');
    if (text.length > 2_000_000) throw new Error('Filen är för stor');
    const r = await svc.importTaxAccount(actor, text);
    msg = `${r.added} nya transaktioner av ${r.rows}`;
  });
  done(back(cid), msg);
}

export async function book(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let n = 0;
  await attempt(back(cid), async () => {
    const ids = fd.getAll('id').map(Number).filter(Boolean);
    n = await svc.bookTaxEntries(actor, ids.map((id) => ({ id, account: Number(str(fd, `account_${id}`)) })));
  });
  done(back(cid), `${n} transaktioner bokförda mot 1630`);
}

export async function setStatus(cid: number, id: number, status: 'new' | 'ignored' | 'bank') {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => svc.setTaxEntryStatus(actor, id, status));
  done(back(cid), 'Raden är uppdaterad');
}
