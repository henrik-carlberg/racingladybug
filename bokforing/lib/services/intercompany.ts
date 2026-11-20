import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { monthEnd, today } from '@/lib/format';
import { CHARGE_KINDS, chargeAmount, duePeriods, normOrg, reconcilePair, type ChargeKind } from '@/lib/intercompany';
import type { Actor } from './actor';
import { int, optInt, str } from './input';

const ownerOf = async (companyId: number): Promise<Actor | null> => {
  const [m] = await sql<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE company_id = ${companyId} AND role = 'owner' ORDER BY user_id LIMIT 1`;
  return m ? { companyId, userId: m.user_id, apiKeyId: null, role: 'owner' } : null;
};

/** Koncernbolag som bolaget är kopplat till (moder eller dotter) */
export async function linkedCompanies(companyId: number) {
  return [...await sql<{ id: number; name: string; orgnr: string; relation: string; accepts: boolean }[]>`
    SELECT c.id, c.name, c.orgnr, c.accept_intercompany AS accepts, CASE WHEN g.parent_company_id = ${companyId} THEN 'dotterbolag' ELSE 'moderbolag' END AS relation
    FROM group_links g JOIN companies c ON c.id = CASE WHEN g.parent_company_id = ${companyId} THEN g.subsidiary_company_id ELSE g.parent_company_id END
    WHERE g.parent_company_id = ${companyId} OR g.subsidiary_company_id = ${companyId} ORDER BY c.name`];
}

/**
 * En bokförd kundfaktura till ett koncernbolag (kundens organisationsnummer) blir en leverantörsfaktura hos mottagaren,
 * med samma nummer, belopp, moms och OCR. Den attesteras som vanligt hos mottagaren.
 */
export async function mirrorInvoice(companyId: number, invoiceId: number) {
  const [i] = await sql<{ number: number; date: string; due: string; total: number; vat: number; ocr: string | null; orgnr: string; status: string; credit: boolean; currency: string }[]>`
    SELECT i.invoice_number AS number, to_char(i.invoice_date,'YYYY-MM-DD') AS date, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total::float8 AS total, i.total_vat::float8 AS vat,
      i.ocr, c.orgnr, i.status, i.credit_of_id IS NOT NULL AS credit, i.currency FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`;
  if (!i || i.status === 'draft' || !normOrg(i.orgnr)) return null;
  const target = (await linkedCompanies(companyId)).find((c) => normOrg(c.orgnr) === normOrg(i.orgnr));
  if (!target) return null;
  if ((await sql`SELECT 1 FROM intercompany_invoices WHERE invoice_id = ${invoiceId}`).length) return null;
  const record = async (si: number | null, message: string) => sql`INSERT INTO intercompany_invoices (source_company_id, invoice_id, target_company_id, supplier_invoice_id, message)
    VALUES (${companyId}, ${invoiceId}, ${target.id}, ${si}, ${message}) ON CONFLICT (invoice_id) DO NOTHING`;
  if (!target.accepts) { await record(null, `${target.name} tar inte emot koncernfakturor automatiskt – ägaren slår på det under Koncerninterna flöden`); return null; }
  if (i.credit || i.total <= 0 || i.currency !== 'SEK') { await record(null, 'Kreditfakturor och fakturor i utländsk valuta speglas inte – registrera dem hos mottagaren'); return null; }
  const actor = await ownerOf(target.id);
  if (!actor) { await record(null, 'Mottagaren saknar ägare'); return null; }
  const [me] = await sql<{ name: string; orgnr: string; bankgiro: string }[]>`SELECT name, orgnr, bankgiro FROM companies WHERE id = ${companyId}`;
  let [sup] = await sql<{ id: number }[]>`SELECT id FROM suppliers WHERE company_id = ${target.id} AND regexp_replace(orgnr, '\\D', '', 'g') LIKE ${'%' + normOrg(me.orgnr)} ORDER BY id LIMIT 1`;
  const { createSupplier, registerSupplierInvoice } = await import('./suppliers');
  if (!sup) sup = { id: (await createSupplier(actor, { name: me.name, orgnr: me.orgnr, bankgiro: me.bankgiro, default_account: 4010 })).id };
  try {
    const si = await registerSupplierInvoice(actor, { supplier_id: sup.id, invoice_number: String(i.number), invoice_date: i.date, due_date: i.due, total: i.total, vat: i.vat,
      payment_reference: i.ocr ?? '', description: `Koncernfaktura från ${me.name}` });
    await record(si.id, '');
    return si.id;
  } catch (e) {
    await record(null, e instanceof Error ? e.message.slice(0, 300) : 'Fel');
    return null;
  }
}

/** Mellanhavanden per koncernbolag: kundfordringar och leverantörsskulder åt båda håll. Bara bolag där användaren har behörighet till bokföringen. */
export async function balances(companyId: number, userId: number) {
  const [me] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${companyId}`;
  const out = [];
  for (const c of await linkedCompanies(companyId)) {
    const [m] = await sql`SELECT 1 FROM memberships WHERE company_id = ${c.id} AND user_id = ${userId} AND (role = 'owner' OR (role = 'accountant' AND (permissions IS NULL OR 'ledger' = ANY(permissions))))`;
    const recv = async (from: number, toOrg: string) => Number((await sql<{ s: number }[]>`SELECT COALESCE(SUM(i.total - i.paid_amount), 0)::float8 AS s FROM invoices i JOIN customers cu ON cu.id = i.customer_id
      WHERE i.company_id = ${from} AND i.status = 'booked' AND regexp_replace(cu.orgnr, '\\D', '', 'g') LIKE ${'%' + normOrg(toOrg)}`)[0].s);
    const pay = async (at: number, fromOrg: string) => Number((await sql<{ s: number }[]>`SELECT COALESCE(SUM(i.total - i.paid_amount), 0)::float8 AS s FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.company_id = ${at} AND i.status <> 'paid' AND regexp_replace(s.orgnr, '\\D', '', 'g') LIKE ${'%' + normOrg(fromOrg)}`)[0].s);
    const weOwn = await recv(companyId, c.orgnr);
    const row = { company: c, access: !!m, receivable: weOwn, theirPayable: m ? await pay(c.id, me.orgnr) : null, payable: await pay(companyId, c.orgnr), theirReceivable: m ? await recv(c.id, me.orgnr) : null };
    out.push({ ...row, out: m ? reconcilePair({ receivable: row.receivable, payable: row.theirPayable! }) : null, in: m ? reconcilePair({ receivable: row.theirReceivable!, payable: row.payable }) : null });
  }
  return out;
}

/** Elimineringsunderlag: koncerninterna fakturor i perioden (försäljning hos säljaren, inköp hos köparen) */
export async function eliminations(companyId: number, from: string, to: string) {
  return [...await sql<{ number: number; date: string; target: string; net: number; vat: number; mirrored: boolean; message: string }[]>`
    SELECT i.invoice_number AS number, to_char(i.invoice_date,'YYYY-MM-DD') AS date, c.name AS target, i.total_net::float8 AS net, i.total_vat::float8 AS vat,
      x.supplier_invoice_id IS NOT NULL AS mirrored, x.message
    FROM intercompany_invoices x JOIN invoices i ON i.id = x.invoice_id JOIN companies c ON c.id = x.target_company_id
    WHERE x.source_company_id = ${companyId} AND i.invoice_date BETWEEN ${from} AND ${to} ORDER BY i.invoice_date, i.invoice_number`];
}

// ---------- Koncernavgifter ----------
export async function addCharge(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan lägga upp koncernavgifter');
  const target = int(input, 'target_company_id', 'Koncernbolag');
  const t = (await linkedCompanies(actor.companyId)).find((c) => c.id === target);
  if (!t) throw new ValidationError('Bolaget är inte ett koncernbolag');
  if (!t.accepts) throw new ValidationError(`${t.name} tar inte emot koncernfakturor – ägaren där slår på det först`);
  const kind = str(input, 'kind') as ChargeKind;
  if (!(kind in CHARGE_KINDS)) throw new ValidationError('Välj typ');
  const start = str(input, 'start_period');
  if (!/^\d{4}-\d{2}$/.test(start)) throw new ValidationError('Ange första månaden (ÅÅÅÅ-MM)');
  const amount = kind === 'management_fee' ? optInt(input, 'amount', 'Avgift per månad') ?? 0 : null;
  const principal = kind === 'interest' ? optInt(input, 'principal', 'Lånebelopp') ?? 0 : null;
  const rate = kind === 'interest' ? Number(String(input.rate_pct ?? '').replace(',', '.')) : null;
  if (kind === 'management_fee' && !(amount! > 0)) throw new ValidationError('Ange avgiften per månad');
  if (kind === 'interest' && (!(principal! > 0) || !Number.isFinite(rate) || rate! <= 0 || rate! >= 50)) throw new ValidationError('Ange lånebelopp och ränta');
  await sql`INSERT INTO intercompany_charges (company_id, target_company_id, kind, amount, principal, rate_pct, start_period, created_by)
    VALUES (${actor.companyId}, ${target}, ${kind}, ${amount}, ${principal}, ${rate}, ${start}, ${actor.userId})`;
  await auditBy(sql, actor, 'intercompany_charge', 'company', actor.companyId, { target, kind });
}

export async function listCharges(companyId: number) {
  return [...await sql<{ id: number; target: string; kind: ChargeKind; amount: number | null; principal: number | null; rate_pct: number | null; start_period: string; last_period: string | null; active: boolean }[]>`
    SELECT x.id, c.name AS target, x.kind, x.amount::float8 AS amount, x.principal::float8 AS principal, x.rate_pct::float8 AS rate_pct, x.start_period, x.last_period, x.active
    FROM intercompany_charges x JOIN companies c ON c.id = x.target_company_id WHERE x.company_id = ${companyId} ORDER BY x.id`];
}

/** Fakturerar förfallna månader: en bokförd kundfaktura per månad till koncernbolaget, som speglas hos mottagaren */
export async function runCharges(companyId?: number) {
  let n = 0;
  const current = today().slice(0, 7);
  for (const ch of await sql<{ id: number; company_id: number; target_company_id: number; kind: ChargeKind; amount: number | null; principal: number | null; rate_pct: number | null; start_period: string; last_period: string | null }[]>`
      SELECT id, company_id, target_company_id, kind, amount::float8 AS amount, principal::float8 AS principal, rate_pct::float8 AS rate_pct, start_period, last_period FROM intercompany_charges
      WHERE active ${companyId ? sql`AND company_id = ${companyId}` : sql``}`) {
    const actor = await ownerOf(ch.company_id);
    if (!actor) continue;
    for (const p of duePeriods(ch.last_period, ch.start_period, current)) {
      try {
        const [t] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${ch.target_company_id}`;
        let [cust] = await sql<{ id: number }[]>`SELECT id FROM customers WHERE company_id = ${ch.company_id} AND regexp_replace(orgnr, '\\D', '', 'g') LIKE ${'%' + normOrg(t.orgnr)} ORDER BY id LIMIT 1`;
        const { createCustomer } = await import('./customers');
        if (!cust) cust = { id: (await createCustomer(actor, { name: t.name, orgnr: t.orgnr })).id };
        const k = CHARGE_KINDS[ch.kind];
        const amount = chargeAmount({ kind: ch.kind, amount: ch.amount, principal: ch.principal, ratePct: ch.rate_pct });
        if (amount <= 0) continue;
        const before = (await sql<{ last: string | null }[]>`SELECT last_period AS last FROM intercompany_charges WHERE id = ${ch.id}`)[0].last;
        const claimed = await sql`UPDATE intercompany_charges SET last_period = ${p} WHERE id = ${ch.id} AND last_period IS NOT DISTINCT FROM ${before} AND (last_period IS NULL OR last_period < ${p}) RETURNING id`;
        if (!claimed.length) continue;
        await sql`INSERT INTO accounts (company_id, number, name) VALUES (${ch.company_id}, 3990, 'Övriga ersättningar och intäkter'),
          (${ch.company_id}, 8240, 'Ränteintäkter från långfristiga fordringar hos koncernföretag') ON CONFLICT DO NOTHING`;
        const { saveDraft, bookInvoice } = await import('./invoices');
        try {
        const d = await saveDraft(actor, null, { customer_id: cust.id, invoice_date: monthEnd(p) > today() ? today() : monthEnd(p),
          lines: [{ description: `${k.label} ${p}${ch.kind === 'interest' ? ` (${String(ch.rate_pct).replace('.', ',')} % på ${((ch.principal ?? 0) / 100).toLocaleString('sv-SE')} kr)` : ''}`, quantity: 1, unit: 'st', unit_price: amount, vat_rate: k.vat, account: k.account }] });
        await bookInvoice(actor, d.id);
        } catch (e) {
          // Månaden faktureras igen nästa gång
          await sql`UPDATE intercompany_charges SET last_period = ${before} WHERE id = ${ch.id} AND last_period = ${p}`;
          throw e;
        }
        n++;
      } catch (e) { console.error('koncernavgift', ch.id, p, e instanceof Error ? e.message : e); break; }
    }
  }
  return n;
}

export async function stopCharge(actor: Actor, id: number) {
  const r = await sql`UPDATE intercompany_charges SET active = false WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Avgiften');
}

export async function retryMirror(actor: Actor, invoiceId: number) {
  const r = await sql`DELETE FROM intercompany_invoices WHERE invoice_id = ${invoiceId} AND source_company_id = ${actor.companyId} AND supplier_invoice_id IS NULL RETURNING id`;
  if (!r.length) throw new ConflictError('Fakturan är redan speglad');
  return mirrorInvoice(actor.companyId, invoiceId);
}

/** Mottagarens samtycke: koncernbolag får lägga in leverantörsfakturor (för attest) i det här bolaget */
export async function setAccept(actor: Actor, on: boolean) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan ändra det');
  await sql`UPDATE companies SET accept_intercompany = ${on} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'accept_intercompany', 'company', actor.companyId, { on });
}
