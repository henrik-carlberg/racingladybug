'use server';
import { unstable_rethrow } from 'next/navigation';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { saveOpeningBalances, setSetupFlag } from '@/lib/services/setup';

export async function skipStep(cid: number, key: string, skip: boolean) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/kom-igang`, () => setSetupFlag(actor, `skip_${key}`, skip));
  done(`/c/${cid}/kom-igang`);
}

export async function setHasEmployees(cid: number, value: boolean) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/kom-igang`, () => setSetupFlag(actor, 'has_employees', value));
  done(value ? `/c/${cid}/lon/anstallda` : `/c/${cid}/kom-igang`);
}

export type IbState = { error?: string } | undefined;

export async function saveIb(cid: number, _prev: IbState, fd: FormData): Promise<IbState> {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  try {
    const lines = JSON.parse(str(fd, 'lines') || '[]');
    id = (await saveOpeningBalances(actor, { fiscal_year_id: str(fd, 'fiscal_year_id'), lines })).id;
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/verifikationer/${id}`, 'De ingående balanserna är bokförda');
}
