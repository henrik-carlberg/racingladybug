import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy, changes } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import type { Actor } from './actor';
import { bool, has, list, optInt, str, type Page } from './input';
import { CURRENCIES } from '@/lib/invoice';

export interface CustomerOut {
  id: number; object: 'customer'; name: string; orgnr: string; vat_number: string; email: string; phone: string; address: string;
  postal_code: string; city: string; country: string; payment_terms: number | null; reverse_charge: boolean; construction_rc: boolean; peppol_id: string; currency: string; language: 'sv' | 'en'; created_at: string;
}

const COLS = () => sql`id, 'customer' AS object, name, orgnr, vat_number, email, phone, delivery, address, postal_code, city, country, payment_terms, reverse_charge, construction_rc, peppol_id, currency, language, created_at`;

export async function getCustomer(companyId: number, id: number): Promise<CustomerOut> {
  const [c] = await sql<CustomerOut[]>`SELECT ${COLS()} FROM customers WHERE id = ${id} AND company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  return c;
}

export async function listCustomers(companyId: number, p: Page, f: { q?: string } = {}) {
  const rows = await sql<CustomerOut[]>`SELECT ${COLS()} FROM customers WHERE company_id = ${companyId}
    ${f.q ? sql`AND (name ILIKE ${'%' + f.q + '%'} OR orgnr = ${f.q} OR email ILIKE ${f.q})` : sql``}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  return list([...rows], p);
}

const FIELDS = ['name', 'orgnr', 'vat_number', 'email', 'phone', 'delivery', 'address', 'postal_code', 'city', 'country', 'payment_terms', 'reverse_charge', 'construction_rc', 'peppol_id', 'currency', 'language'] as const;

function read(input: Record<string, unknown>, partial: boolean) {
  const f: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (partial && !has(input, k)) continue;
    if (k === 'payment_terms') f[k] = optInt(input, k, 'Betalningsvillkor');
    else if (k === 'reverse_charge' || k === 'construction_rc') f[k] = bool(input, k);
    else if (k === 'currency') { const v = (str(input, k) || 'SEK').toUpperCase(); if (!(CURRENCIES as readonly string[]).includes(v)) throw new ValidationError(`Valuta stöds inte: ${v}`); f[k] = v; }
    else if (k === 'phone') f[k] = str(input, k, { max: 30 });
    else if (k === 'delivery') { const v = str(input, k) || 'auto'; if (!['auto', 'peppol', 'kivra', 'email', 'paper'].includes(v)) throw new ValidationError('Okänd kanal'); f[k] = v; }
    else if (k === 'language') f[k] = str(input, k) === 'en' ? 'en' : 'sv';
    else if (k === 'vat_number') f[k] = str(input, k).toUpperCase().replace(/\s/g, '');
    else if (k === 'country') f[k] = (str(input, k) || 'SE').toUpperCase().slice(0, 2);
    else if (k === 'peppol_id') { const v = str(input, k).replace(/\s/g, ''); if (v && !/^\d{4}:[A-Za-z0-9.-]+$/.test(v)) throw new ValidationError('Peppol-ID anges som schema:id, t.ex. 0007:5560269986'); f[k] = v; }
    else f[k] = str(input, k, { required: k === 'name', label: k === 'name' ? 'Namn' : k });
  }
  return f;
}

export async function createCustomer(actor: Actor, input: Record<string, unknown>) {
  const f = read(input, false);
  if (f.reverse_charge && !f.vat_number) throw new ValidationError('Omvänd skattskyldighet kräver kundens momsregistreringsnummer');
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO customers ${tx({ ...f, company_id: actor.companyId })} RETURNING id`;
    const [c] = await tx<CustomerOut[]>`SELECT ${COLS()} FROM customers WHERE id = ${id}`;
    await auditBy(tx, actor, 'create', 'customer', id);
    await emit(tx, actor.companyId, 'customer.created', c);
    return c;
  });
}

export async function updateCustomer(actor: Actor, id: number, input: Record<string, unknown>) {
  const f = read(input, true);
  return sql.begin(async (tx) => {
    const [cur] = await tx<CustomerOut[]>`SELECT ${COLS()} FROM customers WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!cur) throw new NotFoundError('Kunden');
    const merged = { ...cur, ...f };
    if (merged.reverse_charge && !merged.vat_number) throw new ValidationError('Omvänd skattskyldighet kräver kundens momsregistreringsnummer');
    if (Object.keys(f).length) await tx`UPDATE customers SET ${tx(f)} WHERE id = ${id}`;
    const [c] = await tx<CustomerOut[]>`SELECT ${COLS()} FROM customers WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'customer', id, { changes: changes(cur as unknown as Record<string, unknown>, f) });
    await emit(tx, actor.companyId, 'customer.updated', c);
    return c;
  });
}
