'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/payroll';
import { applyToRun } from '@/lib/services/absence';

export async function createRun(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let id = 0;
  await attempt(`/c/${cid}/lon`, async () => { id = (await svc.createPayrollRun(actor, { period: str(fd, 'period'), payment_date: str(fd, 'payment_date') })).id; });
  done(`/c/${cid}/lon/${id}`, 'Lönekörningen är skapad');
}

export async function saveSlip(cid: number, runId: number, slipId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}#p${slipId}`, async () => {
    const items = [];
    for (let i = 0; i < 20; i++) {
      const desc = str(fd, `desc_${i}`), amt = str(fd, `amount_${i}`);
      if (!desc && !amt) continue;
      items.push({ type: str(fd, `type_${i}`), description: desc, amount: amount(amt, undefined, `Raden "${desc}"`), account: str(fd, `account_${i}`), code: str(fd, `code_${i}`) });
    }
    await svc.updatePayslip(actor, runId, slipId, { items });
  });
  done(`/c/${cid}/lon/${runId}#p${slipId}`);
}

export async function addEmployee(cid: number, runId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}`, () => svc.addEmployeeToRun(actor, runId, Number(str(fd, 'employee_id'))));
  done(`/c/${cid}/lon/${runId}`);
}

export async function removeSlip(cid: number, runId: number, slipId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}`, () => svc.removePayslip(actor, runId, slipId));
  done(`/c/${cid}/lon/${runId}`);
}

export async function deleteRun(cid: number, runId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}`, () => svc.deletePayrollRun(actor, runId));
  done(`/c/${cid}/lon`, 'Utkastet är borttaget');
}

export async function bookRun(cid: number, runId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}`, () => svc.bookPayrollRun(actor, runId));
  done(`/c/${cid}/lon/${runId}`, 'Lönekörningen är bokförd. Ladda ner AGI-filen och lämna den till Skatteverket (normalt senast den 12:e månaden efter utbetalning, 17:e i januari och augusti).');
}

export async function applyAbsence(cid: number, runId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let n = 0;
  await attempt(`/c/${cid}/lon/${runId}`, async () => { n = await applyToRun(actor, runId); });
  done(`/c/${cid}/lon/${runId}`, n ? `${n} frånvaroperioder är inräknade i lönen` : 'Ingen ny frånvaro att räkna in');
}
