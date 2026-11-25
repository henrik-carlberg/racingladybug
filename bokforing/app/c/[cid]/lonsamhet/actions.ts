'use server';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { attempt, done } from '@/lib/server/action';
import { saveSettings } from '@/lib/services/profitability';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;

export async function settingsAction(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid, { perm: 'invoicing' });
  const path = `/c/${cid}/lonsamhet`;
  await attempt(path, () => saveSettings(userActor(ctx), form(fd)));
  done(path, 'Antagandena är sparade');
}
