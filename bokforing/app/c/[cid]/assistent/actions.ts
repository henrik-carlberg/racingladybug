'use server';
import { requireCompany } from '@/lib/server/auth';
import { limit } from '@/lib/server/ratelimit';
import { ask, AssistantError, type ChatTurn } from '@/lib/services/assistant';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';

export async function askAssistant(cid: number, turns: ChatTurn[]): Promise<{ answer?: string; error?: string }> {
  const { company, user } = await requireCompany(cid);
  if (!invoiceAiEnabled()) return { error: 'Assistenten är inte påslagen' };
  try {
    await limit(`assistant:${company.id}:${user.id}`, 60, 3600);
    const clean = (Array.isArray(turns) ? turns : []).filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string');
    return { answer: await ask(company.id, clean) };
  } catch (e) {
    if (e instanceof AssistantError || (e instanceof Error && e.name === 'RateLimitError')) return { error: e.message };
    if (e instanceof Error && e.message.startsWith('För många')) return { error: e.message };
    return { error: 'Något gick fel – försök igen' };
  }
}
