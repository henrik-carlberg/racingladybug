'use server';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { done } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { isOpsAdmin } from '@/lib/server/monitor';

export async function resolveError(id: number) {
  const user = await requireUser();
  if (!(await isOpsAdmin(user))) notFound();
  await sql`UPDATE error_log SET resolved_at = now() WHERE id = ${id}`;
  done('/drift', 'Felet är markerat som åtgärdat');
}

export async function runTest(key: string) {
  const user = await requireUser();
  if (!(await isOpsAdmin(user))) notFound();
  const { testIntegration } = await import('@/lib/services/integration-tests');
  const r = await testIntegration(key, user);
  const { redirect } = await import('next/navigation');
  redirect(`/drift/installningar?${r.ok ? 'ok' : 'error'}=${encodeURIComponent(r.message)}#${key}`);
}

export async function verifyCompany(companyId: number, on: boolean, q: string) {
  const user = await requireUser();
  if (!(await isOpsAdmin(user))) notFound();
  const { setVerified } = await import('@/lib/services/identity');
  const { redirect } = await import('next/navigation');
  const back = `/drift?bolag=${encodeURIComponent(q.slice(0, 40))}#bolag`;
  try { await setVerified(user.id, companyId, on); }
  catch (e) { redirect(`${back.replace('#bolag', '')}&error=${encodeURIComponent(e instanceof Error ? e.message : 'Fel')}#bolag`); }
  redirect(`${back.replace('#bolag', '')}&ok=${encodeURIComponent(on ? 'Bolaget är verifierat' : 'Verifieringen är borttagen')}#bolag`);
}
