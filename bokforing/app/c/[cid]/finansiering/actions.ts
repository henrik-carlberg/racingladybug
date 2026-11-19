'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/finance';

const back = (cid: number, q = '') => `/c/${cid}/finansiering${q}`;
const act = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function addLoan(cid: number, fd: FormData) {
  const actor = await act(cid);
  let id = 0;
  await attempt(back(cid), async () => { id = await svc.createLoan(actor, { name: str(fd, 'name'), lender: str(fd, 'lender'), principal: amount(fd, 'principal', 'Lånebelopp'), rate_pct: str(fd, 'rate_pct'),
    type: str(fd, 'type'), months: str(fd, 'months'), first_date: str(fd, 'first_date'), loan_account: str(fd, 'loan_account'), disbursed_on: str(fd, 'disbursed_on') }); });
  done(back(cid, `?lan=${id}`), 'Lånet är upplagt med amorteringsplan');
}
export async function bookDue(cid: number) {
  const actor = await act(cid);
  let n = 0;
  await attempt(back(cid), async () => { n = await svc.bookDueLoans(actor.companyId); });
  done(back(cid), `${n} betalningar bokförda`);
}
export async function rate(cid: number, loanId: number, fd: FormData) {
  const actor = await act(cid);
  await attempt(back(cid, `?lan=${loanId}`), () => svc.changeRate(actor, loanId, str(fd, 'rate_pct')));
  done(back(cid, `?lan=${loanId}`), 'Räntan är ändrad och resten av planen omräknad');
}
export async function credit(cid: number, fd: FormData) {
  const actor = await act(cid);
  await attempt(back(cid), () => svc.addCreditLine(actor, { name: str(fd, 'name'), bank_account_id: str(fd, 'bank_account_id'), credit_limit: amount(fd, 'credit_limit', 'Kreditgräns'), rate_pct: str(fd, 'rate_pct') }));
  done(back(cid), 'Krediten är tillagd');
}
export async function offer(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let o = { advance: 0, fee: 0 };
  await attempt(back(cid), async () => { o = await svc.offerInvoice(actor, invoiceId); });
  done(back(cid), `Erbjudande: ${(o.advance / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr utbetalt, avgift ${(o.fee / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr`);
}
export async function accept(cid: number, dealId: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let st: string | null = '';
  await attempt(back(cid), async () => { st = await svc.acceptDeal(actor, dealId); });
  done(back(cid), st === 'funded' ? 'Fakturan är såld och utbetalningen bokförd' : 'Erbjudandet är accepterat – utbetalningen bokförs när finansiären har betalat');
}
export async function refresh(cid: number) {
  const actor = await act(cid);
  await attempt(back(cid), () => svc.refreshDeals(actor.companyId));
  done(back(cid), 'Status hämtad från finansiären');
}
