'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as hr from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'hr'))) throw new Error('HR-modulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/hr`;
const fields = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, str(fd, k)]));

export async function onboarding(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/ny/onboarding`, async () => {
    id = (await hr.startOnboarding(actor, {
      ...fields(fd, ['first_name', 'last_name', 'personal_number', 'email', 'address', 'postal_code', 'city', 'phone', 'employment_start', 'employment_end',
        'employment_type', 'title', 'department', 'manager_employee_id', 'tax_table', 'tax_column', 'working_hours', 'workplace', 'vacation_days',
        'collective_agreement', 'other', 'bank_clearing', 'bank_account']),
      monthly_salary: amount(fd, 'monthly_salary', 'Månadslön') ?? 0, tax_mode: 'table', send_contract: fd.get('send_contract') === 'on',
    }, await requestOrigin())).id;
  });
  done(`${base(cid)}/process/${id}`, 'Onboarding startad');
}

export async function move(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/ny/forflyttning`, async () => {
    id = (await hr.startMove(actor, {
      ...fields(fd, ['employee_id', 'effective_date', 'new_title', 'new_department', 'new_manager_employee_id', 'reason']),
      new_monthly_salary: amount(fd, 'new_monthly_salary', 'Ny lön'), send_document: fd.get('send_document') === 'on',
    }, await requestOrigin())).id;
  });
  done(`${base(cid)}/process/${id}`, 'Förflyttning startad');
}

export async function offboarding(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/ny/offboarding`, async () => {
    id = (await hr.startOffboarding(actor, { ...fields(fd, ['employee_id', 'last_day', 'reason', 'notice_date', 'notes']), send_document: fd.get('send_document') === 'on' },
      await requestOrigin())).id;
  });
  done(`${base(cid)}/process/${id}`, 'Offboarding startad');
}

export async function toggleTask(cid: number, processId: number, taskId: number, isDone: boolean) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/process/${processId}`, () => hr.setTaskDone(actor, processId, taskId, isDone));
  done(`${base(cid)}/process/${processId}`);
}

export async function complete(cid: number, processId: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/process/${processId}`, () => hr.completeProcess(actor, processId, { force: fd.get('force') === 'on' }));
  done(`${base(cid)}/process/${processId}`, 'Processen är slutförd och ändringarna är överförda till lönen');
}

export async function cancel(cid: number, processId: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/process/${processId}`, () => hr.cancelProcess(actor, processId));
  done(`${base(cid)}/process/${processId}`, 'Processen är avbruten');
}

export async function saveProfile(cid: number, employeeId: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/medarbetare/${employeeId}`, () => hr.updateProfile(actor, employeeId, fields(fd, ['title', 'department', 'manager_employee_id', 'employment_type', 'phone', 'emergency_contact'])));
  done(`${base(cid)}/medarbetare/${employeeId}`, 'Uppgifterna är sparade');
}
