'use server';
import { unstable_rethrow } from 'next/navigation';
import { amount, attempt, done, result, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/invoices';
import { sendInvoice as sendSvc } from '@/lib/services/invoice-send';
import { requestOrigin } from '@/lib/server/origin';

export type FormState = { error?: string } | undefined;

/** Sparar ett fakturautkast (nytt eller befintligt) */
export async function saveDraft(cid: number, invoiceId: number | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let id = invoiceId ?? 0;
  try {
    const raw = JSON.parse(str(fd, 'lines') || '[]') as (Record<string, string> & { labor?: boolean })[];
    const lines = raw.filter((r) => r.description || r.price).map((r, i) => ({
      description: r.description, quantity: Number(String(r.quantity).replace(',', '.')), unit: r.unit,
      unit_price: amount(r.price, undefined, `Rad ${i + 1}: pris`), vat_rate: Number(r.vat), account: r.account, labor: !!r.labor,
    }));
    const inv = await svc.saveDraft(actor, invoiceId, {
      customer_id: str(fd, 'customer_id'), invoice_date: str(fd, 'invoice_date'), due_date: str(fd, 'due_date'),
      delivery_date: str(fd, 'delivery_date'), our_reference: str(fd, 'our_reference'), your_reference: str(fd, 'your_reference'),
      notes: str(fd, 'notes'), lines, advance: fd.get('advance') === 'on',
      currency: str(fd, 'currency'), exchange_rate: str(fd, 'exchange_rate'), language: str(fd, 'language'),
      reduction_type: str(fd, 'reduction_type'), buyer_pnr: str(fd, 'buyer_pnr'), work_type: str(fd, 'work_type'), property: str(fd, 'property'),
      brf_orgnr: str(fd, 'brf_orgnr'), apartment_no: str(fd, 'apartment_no'), reduction_max: amount(fd, 'reduction_max', 'Kvar av köparens tak') ?? undefined,
    });
    id = inv.id;
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/fakturor/${id}`, 'Utkastet är sparat');
}

export async function bookInvoice(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => svc.bookInvoice(actor, invoiceId));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Fakturan är bokförd och klar att skicka');
}

export async function deleteDraft(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => svc.deleteDraft(actor, invoiceId));
  done(`/c/${cid}/fakturor`, 'Utkastet är borttaget');
}

export async function registerPayment(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () =>
    svc.registerPayment(actor, invoiceId, { date: str(fd, 'date'), amount: amount(fd, 'amount'), bank_account: str(fd, 'bank_account') }));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Inbetalningen är bokförd');
}

export async function creditInvoice(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let creditId = 0;
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => { creditId = (await svc.creditInvoice(actor, invoiceId, { date: str(fd, 'date') })).id; });
  done(`/c/${cid}/fakturor/${creditId}`, 'Kreditfakturan är bokförd');
}

export async function sendInvoice(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let msg = '';
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => {
    const r = await sendSvc(actor, invoiceId, { to: str(fd, 'to'), message: str(fd, 'message') }, await requestOrigin());
    msg = r.emailed ? `Fakturan är skickad till ${r.to}` : `E-post kunde inte skickas (ej konfigurerad) – dela länken: ${r.link}`;
  });
  done(`/c/${cid}/fakturor/${invoiceId}`, msg);
}

export async function settleAdvance(cid: number, invoiceId: number, advanceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => svc.settleAdvance(actor, invoiceId, advanceId));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Förskottet är avräknat på fakturan');
}

/** Ta bort utkast (kan ångras på klienten: anropas först när tiden för att ångra har gått) */
export async function deleteDraftNow(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  return result(() => svc.deleteDraft(actor, invoiceId));
}

/** Skickar fakturan i den bästa kanal kunden kan ta emot: e-faktura, Kivra, e-post – annars utskrift */
export async function sendBest(cid: number, invoiceId: number) {
  const { channelFor, sendInvoiceKivra } = await import('@/lib/services/kivra');
  const peppol = await import('@/lib/services/peppol');
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const back = `/c/${cid}/fakturor/${invoiceId}`;
  let msg = '';
  await attempt(back, async () => {
    const c = await channelFor(actor.companyId, invoiceId);
    if (c.channel === 'peppol') { await peppol.sendInvoice(actor, invoiceId); msg = 'Fakturan är skickad som e-faktura (Peppol)'; }
    else if (c.channel === 'kivra') { await sendInvoiceKivra(actor, invoiceId, await requestOrigin()); msg = 'Fakturan är skickad till kundens Kivra'; }
    else if (c.channel === 'email') { const r = await sendSvc(actor, invoiceId, {}, await requestOrigin()); msg = r.emailed ? `Fakturan är skickad med e-post till ${r.to}` : `E-post kunde inte skickas – dela länken: ${r.link}`; }
    else msg = 'Kunden kan inte ta emot fakturan digitalt – skriv ut den och skicka med post';
  });
  done(back, msg);
}

export async function sendKivra(cid: number, invoiceId: number) {
  const { sendInvoiceKivra } = await import('@/lib/services/kivra');
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => sendInvoiceKivra(actor, invoiceId, await requestOrigin()));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Fakturan är skickad till kundens Kivra');
}

export async function refreshKivraStatus(cid: number, invoiceId: number) {
  const { refreshKivra } = await import('@/lib/services/kivra');
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => refreshKivra(company.id));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Status hämtad från Kivra');
}
