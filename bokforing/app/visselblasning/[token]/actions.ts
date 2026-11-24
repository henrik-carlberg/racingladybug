'use server';
import { reporterReply, submit, thread } from '@/lib/services/whistleblowing';
import { clientIp, limit, LIMITS } from '@/lib/server/ratelimit';

export type SubmitState = { code?: string; error?: string };
export type ThreadState = { code?: string; error?: string; thread?: Awaited<ReturnType<typeof thread>> };
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Något gick fel');

/** Rapport via den publika länken. Ärendekoden visas bara här och lagras endast som hash. */
export async function submitAction(token: string, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  try {
    await limit(`whistle:${token}:${await clientIp()}`, LIMITS.publicAction.max, LIMITS.publicAction.window);
    return { code: await submit(token, form(fd)) };
  } catch (e) { return { error: msg(e) }; }
}

/** Följ ärendet med koden (begränsat antal försök per adress mot gissning) */
export async function threadAction(token: string, _prev: ThreadState, fd: FormData): Promise<ThreadState> {
  const code = String(fd.get('code') ?? '');
  try {
    await limit(`whistle-code:${token}:${await clientIp()}`, LIMITS.publicAction.max, LIMITS.publicAction.window);
    const reply = String(fd.get('reply') ?? '').trim();
    return { code, thread: reply ? await reporterReply(token, code, reply) : await thread(token, code) };
  } catch (e) { return { error: msg(e) === 'Ärendet finns inte' ? 'Hittar inget ärende med den koden' : msg(e) }; }
}
