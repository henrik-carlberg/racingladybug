'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'lager'))) throw new Error('Lagermodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/lager`;
const ROWS = 8;

/** Orderrader från formuläret: product_N, qty_N, price_N */
function orderLines(fd: FormData) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ROWS; i++) {
    const pid = str(fd, `product_${i}`);
    if (!pid) continue;
    const price = amount(fd, `price_${i}`, `Rad ${i + 1}: pris`);
    out.push({ product_id: pid, qty: str(fd, `qty_${i}`), ...(price != null ? { unit_price: price } : {}) });
  }
  return out;
}

export async function saveProduct(cid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  let pid = id ?? 0;
  await attempt(id ? `${base(cid)}/artiklar/${id}` : `${base(cid)}/artiklar`, async () => {
    pid = (await svc.saveProduct(actor, id, {
      sku: str(fd, 'sku'), name: str(fd, 'name'), unit: str(fd, 'unit'), purchase_price: amount(fd, 'purchase_price', 'Inköpspris'),
      sales_price: amount(fd, 'sales_price', 'Försäljningspris'), vat_rate: str(fd, 'vat_rate'), reorder_point: str(fd, 'reorder_point'),
      reorder_qty: str(fd, 'reorder_qty'), supplier_id: str(fd, 'supplier_id'), supplier_sku: str(fd, 'supplier_sku'), barcode: str(fd, 'barcode'),
      active: id ? fd.get('active') === 'on' : true, opening_qty: str(fd, 'opening_qty'), warehouse_id: str(fd, 'warehouse_id'),
    })).id;
  });
  done(`${base(cid)}/artiklar/${pid}`, id ? 'Artikeln är sparad' : 'Artikeln är upplagd');
}

export async function addWarehouse(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.createWarehouse(actor, { name: str(fd, 'name'), address: str(fd, 'address') }));
  done(base(cid), 'Lagerstället är upplagt');
}

export async function transfer(cid: number, pid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/artiklar/${pid}`, () => svc.transfer(actor, {
    product_id: pid, from_warehouse_id: str(fd, 'from'), to_warehouse_id: str(fd, 'to'), qty: str(fd, 'qty'), note: str(fd, 'note'),
  }));
  done(`${base(cid)}/artiklar/${pid}`, 'Flytten är registrerad');
}

export async function count(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let n = 0;
  const wid = str(fd, 'warehouse_id');
  await attempt(`${base(cid)}/inventering?lager=${wid}`, async () => {
    const counts = fd.getAll('product_id').map(String).map((p) => ({ product_id: p, counted: str(fd, `counted_${p}`) }));
    n = (await svc.applyCount(actor, { warehouse_id: wid, date: str(fd, 'date'), counts })).changed;
  });
  done(`${base(cid)}/inventering?lager=${wid}`, `Inventeringen är registrerad – ${n} artiklar justerade`);
}

export async function createPO(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/inkop`, async () => {
    id = (await svc.createPO(actor, {
      supplier_id: str(fd, 'supplier_id'), warehouse_id: str(fd, 'warehouse_id'), expected_date: str(fd, 'expected_date'), notes: str(fd, 'notes'), lines: orderLines(fd),
    })).id;
  });
  done(`${base(cid)}/inkop/${id}`, 'Inköpsordern är skapad');
}

export async function suggestedPOs(cid: number) {
  const actor = await ctx(cid);
  let n = 0;
  await attempt(`${base(cid)}/inkop`, async () => { n = (await svc.createSuggestedPOs(actor)).length; });
  done(`${base(cid)}/inkop`, `${n} inköpsorder är skapade från beställningsförslaget`);
}

export async function poStatus(cid: number, id: number, status: 'sent' | 'cancelled') {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/inkop/${id}`, () => svc.setPOStatus(actor, id, status));
  done(`${base(cid)}/inkop/${id}`, status === 'sent' ? 'Ordern är markerad som skickad' : 'Ordern är makulerad');
}

export async function receivePO(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/inkop/${id}`, () => svc.receivePO(actor, id, {
    date: str(fd, 'date'), lines: fd.getAll('line_id').map(String).map((l) => ({ line_id: l, qty: str(fd, `recv_${l}`) })),
  }));
  done(`${base(cid)}/inkop/${id}`, 'Inleveransen är registrerad');
}

export async function invoicePO(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  let sid = 0;
  await attempt(`${base(cid)}/inkop/${id}`, async () => {
    sid = (await svc.invoicePO(actor, id, {
      invoice_number: str(fd, 'invoice_number'), invoice_date: str(fd, 'invoice_date'), due_date: str(fd, 'due_date'),
      ...(str(fd, 'total') ? { total: amount(fd, 'total', 'Totalbelopp'), vat: amount(fd, 'vat', 'Moms') ?? 0 } : {}),
    })).id;
  });
  done(`/c/${cid}/leverantorsfakturor/${sid}`, 'Leverantörsfakturan är registrerad från inköpsordern');
}

export async function createSO(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/order`, async () => {
    id = (await svc.createSO(actor, {
      customer_id: str(fd, 'customer_id'), warehouse_id: str(fd, 'warehouse_id'), delivery_address: str(fd, 'delivery_address'),
      your_reference: str(fd, 'your_reference'), notes: str(fd, 'notes'), lines: orderLines(fd),
    })).id;
  });
  done(`${base(cid)}/order/${id}`, 'Kundordern är skapad');
}

export async function shipSO(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/order/${id}`, () => svc.shipSO(actor, id, { date: str(fd, 'date'), carrier: str(fd, 'carrier'), tracking: str(fd, 'tracking') }));
  done(`${base(cid)}/order/${id}`, 'Ordern är levererad och dragen från lagret');
}

export async function invoiceSO(cid: number, id: number) {
  const actor = await ctx(cid);
  let iid = 0;
  await attempt(`${base(cid)}/order/${id}`, async () => { iid = (await svc.invoiceSO(actor, id)).id; });
  done(`/c/${cid}/fakturor/${iid}`, 'Fakturautkastet är skapat från kundordern');
}

export async function cancelSO(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/order/${id}`, () => svc.cancelSO(actor, id));
  done(`${base(cid)}/order/${id}`, 'Ordern är makulerad');
}

export async function bookValuation(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/varde`, () => svc.bookValuation(actor, { date: str(fd, 'date'), use97: fd.get('use97') === 'on' }));
  done(`${base(cid)}/varde`, 'Lagervärderingen är bokförd');
}
