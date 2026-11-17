import { kr } from '@/lib/format';
import type { FormField } from '@/lib/taxforms';

/** Visar blankettrutor med belopp i hela kronor och vilka konton som ingår */
export function FormTable({ title, fields, hideZero = true }: { title: string; fields: FormField[]; hideZero?: boolean }) {
  const shown = fields.filter((f) => !hideZero || f.amount !== 0);
  return (
    <>
      <h3>{title}</h3>
      <table>
        <thead><tr><th style={{ width: 60 }}>Ruta</th><th>Benämning</th><th className="num">Belopp (kr)</th><th className="small">Konton</th></tr></thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.code + f.box}><td><b>{f.box}</b></td><td>{f.label}</td>
              <td className="num">{f.sign === '-' ? '−' : ''}{kr(Math.round(f.amount / 100) * 100).replace(/,00$/, '')}</td>
              <td className="small muted">{f.accounts.join(', ')}</td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} className="muted">Inga belopp.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
