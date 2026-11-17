'use server';
import { redirect } from 'next/navigation';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import * as bank from '@/lib/services/bank';

const back = (cid: number) => `/c/${cid}/bank`;

export async function connectBank(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let url = '';
  await attempt(back(cid), async () => {
    url = await bank.startConnection(actor, { aspsp: str(fd, 'aspsp'), country: 'SE', psu_type: str(fd, 'psu_type') }, `${await requestOrigin()}/bank/callback`);
  });
  redirect(url); // till bankens inloggning (BankID)
}

export async function disconnectBank(cid: number, connectionId: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => bank.disconnect(actor, connectionId));
  done(back(cid), 'Banken är bortkopplad');
}

export async function addManualAccount(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(back(cid), () => bank.createManualAccount(actor, { name: str(fd, 'name'), iban: str(fd, 'iban'), ledger_account: str(fd, 'ledger_account') }));
  done(back(cid), 'Bankkontot är tillagt');
}

export async function setLedger(cid: number, accountId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(back(cid), () => bank.updateAccountLedger(actor, accountId, Number(str(fd, 'ledger_account'))));
  done(back(cid), 'Bokföringskontot är ändrat');
}

export async function sync(cid: number, accountId: number) {
  const actor = userActor(await requireCompany(cid));
  let r = { imported: 0, duplicates: 0 };
  await attempt(back(cid), async () => { r = await bank.syncAccount(actor, accountId); });
  done(`/c/${cid}/bank/avstamning`, `${r.imported} nya transaktioner hämtade från banken`);
}

export async function importStatement(cid: number, accountId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let r = { imported: 0, duplicates: 0 };
  await attempt(back(cid), async () => {
    const f = fd.get('file');
    if (!(f instanceof File) || f.size === 0) throw new Error('Välj en fil');
    if (f.size > 10_000_000) throw new Error('Filen är för stor');
    const buf = Buffer.from(await f.arrayBuffer());
    // Svenska bankers CSV kan vara Windows-1252 (Latin-1); camt.053 är UTF-8
    const utf8 = buf.toString('utf8');
    const content = utf8.includes('�') ? buf.toString('latin1') : utf8;
    r = await bank.importFile(actor, accountId, f.name, content);
  });
  done(`/c/${cid}/bank/avstamning`, `${r.imported} transaktioner importerade${r.duplicates ? `, ${r.duplicates} fanns redan` : ''}`);
}

export async function reconcileTx(cid: number, txId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  const ret = `/c/${cid}/bank/avstamning${str(fd, 'qs') ? `?${str(fd, 'qs')}` : ''}`;
  await attempt(ret, () => bank.reconcile(actor, txId, {
    type: str(fd, 'type'), id: str(fd, 'id') || undefined, account: str(fd, 'account') || undefined,
    vat_rate: str(fd, 'vat_rate') || undefined, description: str(fd, 'description') || undefined,
  }));
  done(ret, 'Transaktionen är avstämd');
}

export async function reopenTx(cid: number, txId: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/bank/avstamning?status=matched`, () => bank.reopen(actor, txId));
  done(`/c/${cid}/bank/avstamning`, 'Transaktionen är öppnad igen');
}

export async function autoMatch(cid: number) {
  const actor = userActor(await requireCompany(cid));
  let n = 0;
  await attempt(`/c/${cid}/bank/avstamning`, async () => { n = await bank.autoMatch(actor); });
  done(`/c/${cid}/bank/avstamning`, `${n} transaktioner stämdes av automatiskt`);
}
