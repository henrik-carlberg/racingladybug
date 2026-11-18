import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { previewImport, type ImportKind, type ImportPreview } from '@/lib/csv-import';
import { makeOcr } from '@/lib/validate';
import { enabledModules } from '@/lib/modules/enabled';
import type { Actor } from './actor';

export const IMPORT_KINDS: ImportKind[] = ['customers', 'suppliers', 'articles', 'customer_invoices', 'supplier_invoices'];

export async function preview(actor: Actor, kind: ImportKind, text: string): Promise<ImportPreview> {
  if (!IMPORT_KINDS.includes(kind)) throw new ValidationError('Välj vad som ska importeras');
  if (kind === 'articles' && !(await enabledModules(actor.companyId)).some((m) => m.id === 'lager')) throw new ValidationError('Artiklar importeras till lagermodulen – slå på den under Moduler först');
  return previewImport(kind, text);
}

type Row = Record<string, string | number | null>;
const s = (v: unknown) => (v == null ? '' : String(v));

async function findOrCreate(tx: Tx, actor: Actor, table: 'customers' | 'suppliers', name: string, orgnr: string, cache: Map<string, number>) {
  const key = orgnr ? `o:${orgnr}` : `n:${name.toLowerCase()}`;
  if (cache.has(key)) return { id: cache.get(key)!, created: false };
  const [hit] = table === 'customers'
    ? await tx<{ id: number }[]>`SELECT id FROM customers WHERE company_id = ${actor.companyId} AND (${orgnr} <> '' AND orgnr = ${orgnr} OR lower(name) = ${name.toLowerCase()}) ORDER BY (orgnr = ${orgnr}) DESC LIMIT 1`
    : await tx<{ id: number }[]>`SELECT id FROM suppliers WHERE company_id = ${actor.companyId} AND (${orgnr} <> '' AND orgnr = ${orgnr} OR lower(name) = ${name.toLowerCase()}) ORDER BY (orgnr = ${orgnr}) DESC LIMIT 1`;
  if (hit) { cache.set(key, hit.id); return { id: hit.id, created: false }; }
  const [r] = table === 'customers'
    ? await tx<{ id: number }[]>`INSERT INTO customers (company_id, name, orgnr) VALUES (${actor.companyId}, ${name}, ${orgnr}) RETURNING id`
    : await tx<{ id: number }[]>`INSERT INTO suppliers (company_id, name, orgnr) VALUES (${actor.companyId}, ${name}, ${orgnr}) RETURNING id`;
  cache.set(key, r.id);
  return { id: r.id, created: true };
}

/** Sparar en granskad import. Befintliga poster (samma org.nr/namn, artikelnummer eller fakturanummer) hoppas över. */
export async function commit(actor: Actor, kind: ImportKind, text: string) {
  const p = await preview(actor, kind, text);
  if (p.missing.length) throw new ValidationError(`Kolumner saknas: ${p.missing.join(', ')}`);
  if (p.errors.length) throw new ValidationError(`Filen har ${p.errors.length} fel – rätta dem och försök igen`);
  return sql.begin(async (tx) => {
    let created = 0, skipped = 0, related = 0;
    const cache = new Map<string, number>();
    for (const r of p.rows as Row[]) {
      if (kind === 'customers' || kind === 'suppliers') {
        const name = s(r.name), orgnr = s(r.orgnr);
        const { id, created: c } = await findOrCreate(tx, actor, kind, name, orgnr, cache);
        if (!c) { skipped++; continue; }
        if (kind === 'customers') await tx`UPDATE customers SET vat_number = ${s(r.vat_number)}, email = ${s(r.email)}, address = ${s(r.address)}, postal_code = ${s(r.postal_code)},
          city = ${s(r.city)}, country = ${s(r.country) || 'SE'}, payment_terms = ${r.payment_terms ?? null}, reverse_charge = ${s(r.country) !== '' && s(r.country) !== 'SE' && s(r.vat_number) !== ''} WHERE id = ${id}`;
        else await tx`UPDATE suppliers SET bankgiro = ${s(r.bankgiro)}, plusgiro = ${s(r.plusgiro)}, bank_account = ${s(r.bank_account)}, email = ${s(r.email)}, default_account = ${Number(r.default_account) || 4010} WHERE id = ${id}`;
        created++;
      } else if (kind === 'articles') {
        const res = await tx`INSERT INTO inv_products (company_id, sku, name, unit, sales_price, purchase_price, vat_rate)
          VALUES (${actor.companyId}, ${s(r.sku)}, ${s(r.name)}, ${s(r.unit) || 'st'}, ${Number(r.sales_price)}, ${Number(r.purchase_price)}, ${Number(r.vat_rate)})
          ON CONFLICT (company_id, sku) DO NOTHING RETURNING id`;
        if (res.length) created++; else skipped++;
      } else if (kind === 'customer_invoices') {
        const no = Number(r.number);
        const [exists] = await tx`SELECT 1 FROM invoices WHERE company_id = ${actor.companyId} AND invoice_number = ${no}`;
        if (exists) { skipped++; continue; }
        const cust = await findOrCreate(tx, actor, 'customers', s(r.customer), s(r.orgnr), cache);
        if (cust.created) related++;
        const amount = Number(r.amount);
        const [{ id }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({
          company_id: actor.companyId, customer_id: cust.id, invoice_number: no, ocr: s(r.ocr) || makeOcr(no), invoice_date: s(r.invoice_date), due_date: s(r.due_date),
          status: 'booked', imported: true, notes: 'Importerad från tidigare system', total_net: amount, total_vat: 0, rounding: 0, total: amount,
        })} RETURNING id`;
        await tx`INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit, unit_price, vat_rate, account_number, labor)
          VALUES (${id}, 1, ${`Obetald faktura ${no} från tidigare system`}, 1, 'st', ${amount}, 0, 1510, false)`;
        created++;
      } else {
        const sup = await findOrCreate(tx, actor, 'suppliers', s(r.supplier), s(r.orgnr), cache);
        if (sup.created) related++;
        const [exists] = await tx`SELECT 1 FROM supplier_invoices WHERE company_id = ${actor.companyId} AND supplier_id = ${sup.id} AND invoice_number = ${s(r.number)}`;
        if (exists) { skipped++; continue; }
        await tx`INSERT INTO supplier_invoices ${tx({
          company_id: actor.companyId, supplier_id: sup.id, invoice_number: s(r.number), invoice_date: s(r.invoice_date), due_date: s(r.due_date),
          payment_reference: s(r.reference), description: 'Importerad från tidigare system', total: Number(r.amount), vat: 0, status: 'booked', imported: true,
        })}`;
        created++;
      }
    }
    // Fakturanumreringen fortsätter efter de importerade numren
    if (kind === 'customer_invoices') await tx`UPDATE companies SET next_invoice_no = GREATEST(next_invoice_no, COALESCE((SELECT max(invoice_number) + 1 FROM invoices WHERE company_id = ${actor.companyId}), 1)) WHERE id = ${actor.companyId}`;
    await auditBy(tx, actor, 'import', kind, actor.companyId, { created, skipped, related });
    return { created, skipped, related };
  });
}
