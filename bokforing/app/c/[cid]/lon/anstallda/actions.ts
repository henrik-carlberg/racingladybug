'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createEmployee, updateEmployee } from '@/lib/services/payroll';

export async function saveEmployee(cid: number, id: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(id ? `/c/${cid}/lon/anstallda/${id}` : `/c/${cid}/lon/anstallda`, async () => {
    const input: Record<string, unknown> = { active: fd.get('active') === 'on', monthly_salary: amount(fd, 'monthly_salary', 'Månadslön') ?? 0 };
    for (const k of ['first_name', 'last_name', 'personal_number', 'email', 'address', 'postal_code', 'city', 'bank_clearing', 'bank_account',
      'employment_start', 'employment_end', 'tax_mode', 'tax_table', 'tax_column', 'tax_percent', 'fee_override', 'vacation_days', 'hours_per_week', 'pension_percent', 'vacation_rule', 'employment_form', 'title', 'id06']) input[k] = str(fd, k);
    input.car_benefit = amount(fd, 'car_benefit', 'Bilförmån') ?? 0;
    return id ? updateEmployee(actor, id, input) : createEmployee(actor, input);
  });
  done(`/c/${cid}/lon/anstallda`, 'Den anställda är sparad');
}
