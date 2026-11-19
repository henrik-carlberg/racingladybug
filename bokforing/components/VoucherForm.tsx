'use client';
import { useActionState, useState } from 'react';
import { parseAmount, formatAmount } from '@/lib/money';
import type { FormState } from '@/app/c/[cid]/verifikationer/actions';
import { voucherChecks, type Period } from '@/lib/checks';
import { Checks } from './Checks';

type Row = { account: string; debit: string; credit: string; description: string; cc: string; project: string };
const empty = (): Row => ({ account: '', debit: '', credit: '', description: '', cc: '', project: '' });

export function VoucherForm({ action, accounts, today, costCenters = [], projects = [], initial, period }: {
  period?: Period;
  initial?: { date?: string; description: string; rows: { account: number; debit: number; credit: number; description: string }[] };
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  accounts: { number: number; name: string }[];
  today: string;
  costCenters?: { id: number; code: string; name: string }[];
  projects?: { id: number; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const amt = (o: number) => (o ? formatAmount(o).replace(/ /g, '') : '');
  const [rows, setRows] = useState<Row[]>(initial?.rows.length ? initial.rows.map((r) => ({ ...empty(), account: String(r.account), debit: amt(r.debit), credit: amt(r.credit), description: r.description ?? '' })) : [empty(), empty()]);
  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const sum = (k: 'debit' | 'credit') => rows.reduce((s, r) => s + (parseAmount(r[k]) ?? 0), 0);
  const diff = sum('debit') - sum('credit');
  const [date, setDate] = useState(initial?.date ?? today);
  const checks = period ? voucherChecks({ date, today, period, lines: rows.filter((r) => r.account).map((r) => ({ account: Number(r.account), debit: parseAmount(r.debit) ?? 0, credit: parseAmount(r.credit) ?? 0 })) }) : [];
  const blocked = checks.some((c) => c.level === 'error');
  const name = (n: string) => accounts.find((a) => String(a.number) === n)?.name;
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="flash error">{state.error}</div>}
      <div className="card row">
        <label style={{ flex: '0 0 180px' }}>Datum<input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label style={{ flex: '3 1 300px' }}>Beskrivning<input name="description" required placeholder="T.ex. Kvitto kontorsmaterial" defaultValue={initial?.description} /></label>
      </div>
      <datalist id="accounts">{accounts.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
      <div className="table-wrap">
        <table>
          <thead><tr><th style={{ width: 130 }}>Konto</th><th>Kontonamn</th><th className="num" style={{ width: 150 }}>Debet</th><th className="num" style={{ width: 150 }}>Kredit</th><th>Radtext</th>{costCenters.length > 0 && <th>Kostnadsställe</th>}{projects.length > 0 && <th>Projekt</th>}<th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input list="accounts" value={r.account} onChange={(e) => set(i, 'account', e.target.value)} inputMode="numeric" /></td>
                <td className="small muted">{name(r.account) ?? (r.account ? 'Okänt konto' : '')}</td>
                <td><input value={r.debit} onChange={(e) => set(i, 'debit', e.target.value)} inputMode="decimal" style={{ textAlign: 'right' }} /></td>
                <td><input value={r.credit} onChange={(e) => set(i, 'credit', e.target.value)} inputMode="decimal" style={{ textAlign: 'right' }} /></td>
                <td><input value={r.description} onChange={(e) => set(i, 'description', e.target.value)} /></td>
                {costCenters.length > 0 && <td><select aria-label="Kostnadsställe" value={r.cc} onChange={(e) => set(i, 'cc', e.target.value)}><option value="">–</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></td>}
                {projects.length > 0 && <td><select aria-label="Projekt" value={r.project} onChange={(e) => set(i, 'project', e.target.value)}><option value="">–</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>}
                <td><button type="button" className="link" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
            <tr className="sum">
              <td colSpan={2}>Summa {diff !== 0 && <span style={{ color: 'var(--danger)' }}>(diff {formatAmount(diff)})</span>}</td>
              <td className="num">{formatAmount(sum('debit'))}</td><td className="num">{formatAmount(sum('credit'))}</td><td colSpan={2 + (costCenters.length > 0 ? 1 : 0) + (projects.length > 0 ? 1 : 0)}></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ margin: 0 }}>
        <button type="button" className="secondary" onClick={() => setRows((x) => [...x, empty()])}>+ Rad</button>
        {diff !== 0 && (
          <button type="button" className="secondary" onClick={() => {
            const amt = formatAmount(Math.abs(diff)).replace(/ /g, '');
            const side = diff > 0 ? 'credit' : 'debit';
            setRows((x) => {
              // Fyll i första raden som har konto men saknar belopp, annars lägg till en ny rad
              const i = x.findIndex((r) => r.account && !r.debit && !r.credit);
              if (i >= 0) return x.map((r, j) => (j === i ? { ...r, [side]: amt } : r));
              return [...x.filter((r) => r.account || r.debit || r.credit), { ...empty(), [side]: amt }];
            });
          }}>Balansera</button>
        )}
      </div>
      <label>Underlag (kvitto, faktura – valfritt)<input type="file" name="file" accept="image/*,application/pdf" /></label>
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <Checks items={checks} />
      <div><button disabled={pending || diff !== 0 || blocked}>{pending ? 'Bokför…' : 'Bokför'}</button></div>
      <p className="muted small">En bokförd verifikation kan inte ändras eller raderas. Fel rättas med en rättelseverifikation.</p>
    </form>
  );
}
