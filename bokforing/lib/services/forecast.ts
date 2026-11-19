import 'server-only';
import { sql } from '@/lib/db';
import { behavior, predict, type Behavior, type Prediction } from '@/lib/payment-forecast';

/** Betalbeteende per kund (senaste två åren) */
export async function customerBehaviors(companyId: number): Promise<Map<number, Behavior>> {
  const rows = await sql<{ customer_id: number; due: string; paid: string }[]>`
    SELECT customer_id, to_char(due_date,'YYYY-MM-DD') AS due, to_char(paid_date,'YYYY-MM-DD') AS paid FROM invoices
    WHERE company_id = ${companyId} AND status = 'paid' AND paid_date IS NOT NULL AND credit_of_id IS NULL AND NOT advance AND paid_date >= current_date - 730
    ORDER BY customer_id, paid_date`;
  const by = new Map<number, { due: string; paid: string }[]>();
  for (const r of rows) by.set(r.customer_id, [...(by.get(r.customer_id) ?? []), r]);
  const out = new Map<number, Behavior>();
  for (const [c, xs] of by) { const b = behavior(xs); if (b) out.set(c, b); }
  return out;
}

/** Obetalda fakturor som troligen blir sena (kunden brukar betala mer än fem dagar efter förfallodagen) */
export async function likelyLate(companyId: number): Promise<{ id: number; number: number; customer: string; due: string; prediction: Prediction }[]> {
  const b = await customerBehaviors(companyId);
  if (!b.size) return [];
  const open = await sql<{ id: number; number: number; customer_id: number; customer: string; due: string }[]>`
    SELECT i.id, i.invoice_number AS number, i.customer_id, c.name AS customer, to_char(i.due_date,'YYYY-MM-DD') AS due FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.due_date >= current_date`;
  return open.map((o) => ({ ...o, prediction: predict(o.due, b.get(o.customer_id) ?? null) })).filter((o): o is typeof o & { prediction: Prediction } => !!o.prediction?.late);
}
