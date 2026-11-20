'use client';
import { useActionState, useMemo, useState } from 'react';
import { formatAmount, parseAmount } from '@/lib/money';

type Acc = { number: number; name: string; side: 'debit' | 'credit'; hint?: string };
type State = { error?: string } | undefined;

export function OpeningBalanceForm({ action, accounts, years, companyType }: {
  action: (s: State, fd: FormData) => Promise<State>;
  accounts: Acc[];
  years: { id: number; label: string }[];
  companyType: 'AB' | 'EF' | 'HB' | 'KB';
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [values, setValues] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<{ account: string; amount: string }[]>([]);
  const sum = (from: number, to: number) => {
    let s = 0;
    for (const a of accounts) if (a.number >= from && a.number < to) s += parseAmount(values[a.number] ?? '') ?? 0;
    for (const e of extra) { const n = Number(e.account); if (n >= from && n < to) s += parseAmount(e.amount) ?? 0; }
    return s;
  };
  const assets = sum(1000, 2000);
  const liab = sum(2000, 3000);
  const lines = useMemo(() => [
    ...accounts.map((a) => ({ account: a.number, amount: parseAmount(values[a.number] ?? '') ?? 0 })),
    ...extra.map((e) => ({ account: Number(e.account), amount: parseAmount(e.amount) ?? 0 })),
  ].filter((l) => l.account && l.amount), [values, extra, accounts]);
  const row = (a: Acc) => (
    <tr key={a.number}>
      <td>{a.number}</td><td>{a.name}{a.hint && <div className="small muted">{a.hint}</div>}</td>
      <td><input inputMode="decimal" style={{ textAlign: 'right' }} value={values[a.number] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [a.number]: e.target.value }))} /></td>
    </tr>
  );
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="flash error">{state.error}</div>}
      <label style={{ maxWidth: 360 }}>Räkenskapsår<select name="fiscal_year_id">{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></label>
      {companyType === 'AB' && (
        <div className="card small">
          <b>Nystartat aktiebolag?</b> Registrera bara aktiekapitalet som sattes in på bankkontot.{' '}
          <button type="button" className="link" onClick={() => setValues({ 1930: '25000', 2081: '25000' })}>Fyll i 25 000 kr aktiekapital</button>
        </div>
      )}
      <div className="grid" style={{ alignItems: 'start' }}>
        <div>
          <h3>Tillgångar</h3>
          <table><tbody>{accounts.filter((a) => a.number < 2000).map(row)}</tbody></table>
        </div>
        <div>
          <h3>Eget kapital och skulder</h3>
          <table><tbody>{accounts.filter((a) => a.number >= 2000).map(row)}</tbody></table>
        </div>
      </div>
      <details>
        <summary className="small">Andra konton</summary>
        {extra.map((e, i) => (
          <div className="row" key={i}>
            <label>Konto<input value={e.account} onChange={(ev) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, account: ev.target.value } : y)))} /></label>
            <label>Belopp<input value={e.amount} inputMode="decimal" onChange={(ev) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)))} /></label>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setExtra((x) => [...x, { account: '', amount: '' }])}>+ Konto</button>
      </details>
      <div className="card">
        <div className="row"><span>Summa tillgångar</span><b style={{ textAlign: 'right' }}>{formatAmount(assets)} kr</b></div>
        <div className="row"><span>Summa eget kapital och skulder</span><b style={{ textAlign: 'right' }}>{formatAmount(liab)} kr</b></div>
        {assets !== liab
          ? <div className="small" style={{ color: 'var(--danger)' }}>Skillnad {formatAmount(assets - liab)} kr – summorna måste vara lika (se förra årets balansräkning).</div>
          : assets !== 0 && <div className="small" style={{ color: 'var(--ok)' }}>Balanserar ✓</div>}
      </div>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div><button disabled={pending || assets !== liab || lines.length === 0}>Bokför ingående balanser</button></div>
    </form>
  );
}
