'use server';
import { requireCompany } from '@/lib/server/auth';
import { limit } from '@/lib/server/ratelimit';
import { userActor } from '@/lib/services/actor';
import { ask, AssistantError, type ChatTurn, type Suggestion } from '@/lib/services/assistant';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';
import { sql } from '@/lib/db';

export async function askAssistant(cid: number, turns: ChatTurn[]): Promise<{ answer?: string; actions?: Suggestion[]; error?: string }> {
  const { company, user } = await requireCompany(cid);
  if (!invoiceAiEnabled()) return { error: 'Assistenten är inte påslagen' };
  try {
    await limit(`assistant:${company.id}:${user.id}`, 60, 3600);
    const clean = (Array.isArray(turns) ? turns : []).filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string');
    return await ask(company.id, clean);
  } catch (e) {
    if (e instanceof AssistantError || (e instanceof Error && e.name === 'RateLimitError')) return { error: e.message };
    if (e instanceof Error && e.message.startsWith('För många')) return { error: e.message };
    return { error: 'Något gick fel – försök igen' };
  }
}

/** Utför ett förslag som användaren har godkänt. Kontrollerar behörighet och att posterna fortfarande är öppna. */
export async function runSuggestion(cid: number, a: Suggestion): Promise<{ ok?: string; error?: string }> {
  try {
    if (a.type === 'remind') {
      const ctx = await requireCompany(cid, { perm: 'invoicing' });
      const { isModuleEnabled } = await import('@/lib/modules/enabled');
      if (!(await isModuleEnabled(ctx.company.id, 'reskontra'))) return { error: 'Slå på modulen Kundreskontra för att skapa påminnelser' };
      const [inv] = await sql<{ id: number }[]>`SELECT id FROM invoices WHERE company_id = ${ctx.company.id} AND invoice_number = ${Number(a.invoice_number)} AND status = 'booked'`;
      if (!inv) return { error: 'Fakturan är inte längre obetald' };
      const { createReminder } = await import('@/modules/reskontra/service');
      await createReminder(userActor(ctx), inv.id);
      return { ok: `Påminnelse skapad för faktura ${a.invoice_number}` };
    }
    if (a.type === 'match_bank') {
      const ctx = await requireCompany(cid, { perm: 'ledger' });
      const [inv] = await sql<{ id: number }[]>`SELECT id FROM invoices WHERE company_id = ${ctx.company.id} AND invoice_number = ${Number(a.invoice_number)} AND status = 'booked'`;
      if (!inv) return { error: 'Fakturan är inte längre obetald' };
      const { reconcile } = await import('@/lib/services/bank');
      await reconcile(userActor(ctx), Number(a.bank_transaction_id), { type: 'invoice', id: inv.id });
      return { ok: `Insättningen är avstämd mot faktura ${a.invoice_number}` };
    }
    return { error: 'Okänd åtgärd' };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
    return { error: e instanceof Error ? e.message : 'Åtgärden misslyckades' };
  }
}
