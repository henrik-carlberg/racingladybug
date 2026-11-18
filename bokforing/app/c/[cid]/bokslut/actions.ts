'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import { bookOpenInvoices, bookTax, carryForward, closeYear } from '@/lib/services/yearend';
import { createAgmMinutes, saveYearendData } from '@/lib/services/taxreports';

const back = (cid: number, fy: number, sub = '') => `/c/${cid}/bokslut/${fy}${sub}`;

export async function tax(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => bookTax(actor, fy, { amount: amount(fd, 'amount', 'Skatt') ?? undefined }));
  done(back(cid, fy), 'Skatten är bokförd');
}

export async function openInvoices(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let n = { customers: 0, suppliers: 0 };
  await attempt(back(cid, fy), async () => { n = await bookOpenInvoices(actor, fy); });
  done(back(cid, fy), `${n.customers} kundfakturor och ${n.suppliers} leverantörsfakturor är bokförda per bokslutsdagen`);
}

export async function close(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => closeYear(actor, fy));
  done(back(cid, fy), 'Årets resultat är bokfört och räkenskapsåret är stängt. Nästa år är upplagt.');
}

export async function carry(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => carryForward(actor, fy, { dividend: amount(fd, 'dividend', 'Utdelning') ?? 0 }));
  done(back(cid, fy), 'Förra årets resultat är överfört');
}

export async function saveReport(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy, '/arsredovisning'), async () => {
    const board = str(fd, 'board').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, role] = l.split(/\s*[,;]\s*/);
      return { name, role: role || 'Styrelseledamot' };
    });
    await saveYearendData(actor, fy, {
      activity: str(fd, 'activity'), events: str(fd, 'events'), dividend: amount(fd, 'dividend', 'Utdelning') ?? 0, board, place: str(fd, 'place'),
      auditorWaived: fd.get('auditor') !== 'on',
    });
  });
  done(back(cid, fy, '/arsredovisning'), 'Uppgifterna är sparade');
}

export async function minutes(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let id = 0;
  await attempt(back(cid, fy, '/arsredovisning'), async () => {
    id = (await createAgmMinutes(actor, fy, { date: str(fd, 'date'), place: str(fd, 'place'), co_signers: str(fd, 'co_signers') }, await requestOrigin())).id;
  });
  done(`/c/${cid}/dokument/${id}`, 'Årsstämmoprotokollet är skickat för signering');
}
