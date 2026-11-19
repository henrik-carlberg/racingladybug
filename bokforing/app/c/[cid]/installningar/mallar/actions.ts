'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { resetTemplate, saveTemplate } from '@/lib/services/templates';
import type { TemplateKind } from '@/lib/email-templates';

const KINDS = ['invoice', 'reminder', 'thanks'];
const base = (cid: number) => `/c/${cid}/installningar/mallar`;

export async function save(cid: number, kind: string, fd: FormData) {
  if (!KINDS.includes(kind)) throw new Error('Okänd mall');
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(`${base(cid)}#${kind}`, () => saveTemplate(a, kind as TemplateKind, { subject: str(fd, 'subject'), body: String(fd.get('body') ?? ''), enabled: kind !== 'thanks' || fd.get('enabled') === 'on' }));
  done(`${base(cid)}#${kind}`, 'Mallen är sparad');
}
export async function reset(cid: number, kind: string) {
  if (!KINDS.includes(kind)) throw new Error('Okänd mall');
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await resetTemplate(a, kind as TemplateKind);
  done(`${base(cid)}#${kind}`, 'Standardtexten används igen');
}
