'use server';
import { unstable_rethrow } from 'next/navigation';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/invoices';
import { sendInvoice as sendSvc } from '@/lib/services/invoice-send';
import { requestOrigin } from '@/lib/server/origin';

export type FormState = { error?: string } | undefined;

/** Sparar ett fakturautkast (nytt eller befintligt) */
export async function saveDraft(cid: number, invoiceId: number | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = userActor(await requireCompany(cid));
  let id = invoiceId ?? 0;
  try {
    const raw = JSON.parse(str(fd, 'lines') || '[]') as Record<string, string>[];
    const lines = raw.filter((r) => r.description || r.price).map((r, i) => ({
      description: r.description, quantity: Number(String(r.quantity).replace(',', '.')), unit: r.unit,
      unit_price: amount(r.price, undefined, `Rad ${i + 1}: pris`), vat_rate: Number(r.vat), account: r.account,
    }));
    const inv = await svc.saveDraft(actor, invoiceId, {
      customer_id: str(fd, 'customer_id'), invoice_date: str(fd, 'invoice_date'), due_date: str(fd, 'due_date'),
      delivery_date: str(fd, 'delivery_date'), our_reference: str(fd, 'our_reference'), your_reference: str(fd, 'your_reference'),
      notes: str(fd, 'notes'), lines,
    });
    id = inv.id;
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/fakturor/${id}`, 'Utkastet är sparat');
}

export async function bookInvoice(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => svc.bookInvoice(actor, invoiceId));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Fakturan är bokförd och klar att skicka');
}

export async function deleteDraft(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, () => svc.deleteDraft(actor, invoiceId));
  done(`/c/${cid}/fakturor`, 'Utkastet är borttaget');
}

export async function registerPayment(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () =>
    svc.registerPayment(actor, invoiceId, { date: str(fd, 'date'), amount: amount(fd, 'amount'), bank_account: str(fd, 'bank_account') }));
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Inbetalningen är bokförd');
}

export async function creditInvoice(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let creditId = 0;
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => { creditId = (await svc.creditInvoice(actor, invoiceId, { date: str(fd, 'date') })).id; });
  done(`/c/${cid}/fakturor/${creditId}`, 'Kreditfakturan är bokförd');
}

export async function sendInvoice(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let msg = '';
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => {
    const r = await sendSvc(actor, invoiceId, { to: str(fd, 'to'), message: str(fd, 'message') }, await requestOrigin());
    msg = r.emailed ? `Fakturan är skickad till ${r.to}` : `E-post kunde inte skickas (ej konfigurerad) – dela länken: ${r.link}`;
  });
  done(`/c/${cid}/fakturor/${invoiceId}`, msg);
}
