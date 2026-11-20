'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import * as svc from '@/lib/services/firm-tasks';

const base = (firmId: number) => `/byra/uppgifter?f=${firmId}`;
const num = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function assignTask(firmId: number, fd: FormData) {
  const user = await requireUser();
  await attempt(base(firmId), () => svc.assign(user.id, firmId, { company_id: num(fd.get('company_id')) ?? 0, deadline_key: str(fd, 'deadline_key') || undefined, task_id: num(fd.get('task_id')) ?? undefined, assignee: num(fd.get('assignee')) }));
  done(base(firmId), 'Ansvarig är satt');
}

export async function addTask(firmId: number, fd: FormData) {
  const user = await requireUser();
  await attempt(base(firmId), () => svc.addTask(user.id, firmId, { company_id: num(fd.get('company_id')) ?? 0, title: str(fd, 'title'), due: str(fd, 'due'), assignee: num(fd.get('assignee')) }));
  done(base(firmId), 'Uppgiften är tillagd');
}

export async function completeTask(firmId: number, fd: FormData) {
  const user = await requireUser();
  await attempt(base(firmId), () => svc.complete(user.id, firmId, { company_id: num(fd.get('company_id')) ?? 0, deadline_key: str(fd, 'deadline_key') || undefined, task_id: num(fd.get('task_id')) ?? undefined }));
  done(base(firmId), 'Markerad som klar');
}
