'use server';
import { done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { runIntegrity } from '@/lib/services/integrity';

export async function runNow(cid: number) {
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const r = await runIntegrity(company.id);
  done(`/c/${company.id}/installningar/integritet`, r.errors ? `${r.errors} avvikelser hittades` : 'Kontrollen är klar – inga fel hittades');
}
