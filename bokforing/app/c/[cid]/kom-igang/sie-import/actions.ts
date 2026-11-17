'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { importSie, uploadSie } from '@/lib/services/sie-import';

export async function upload(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  const back = `/c/${cid}/kom-igang/sie-import`;
  let id = 0;
  await attempt(back, async () => {
    const f = fd.get('file');
    if (!(f instanceof File) || !f.size) throw new Error('Välj en SIE-fil');
    id = await uploadSie(actor, f.name, new Uint8Array(await f.arrayBuffer()));
  });
  done(`${back}?id=${id}`);
}

export async function run(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  const back = `/c/${cid}/kom-igang/sie-import?id=${id}`;
  let msg = '';
  await attempt(back, async () => {
    const r = await importSie(actor, id, { accounts: fd.get('accounts') === 'on', opening: fd.get('opening') === 'on', vouchers: fd.get('vouchers') === 'on' });
    msg = `Importen är klar: ${r.accounts} nya konton${r.opening ? ', ingående balanser' : ''}, ${r.vouchers} verifikationer`;
  });
  done(back, msg);
}
