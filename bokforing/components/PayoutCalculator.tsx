'use client';
import { useState } from 'react';
import { compareScenarios } from '@/lib/k10';
import { formatAmount, parseAmount } from '@/lib/money';

const krs = (o: number) => formatAmount(Math.round(o / 100) * 100, { decimals: false }) + ' kr';

/** Lön eller utdelning: vad blir kvar till ägaren? (förenklad beräkning) */
export function PayoutCalculator({ profit: initialProfit, limit, threshold }: { profit: number; limit: number; threshold: number }) {
  const [profit, setProfit] = useState(initialProfit > 0 ? formatAmount(initialProfit, { decimals: false }) : '');
  const [tax, setTax] = useState('32');
  const p = parseAmount(profit) ?? 0;
  const c = p > 0 ? compareScenarios({ profit: p, limit, municipalTax: Number(tax.replace(',', '.')) || 32, stateThreshold: threshold }) : null;
  const rows = c ? [['Bara lön', c.allSalary], ['Bara utdelning', c.allDividend], ['Lön upp till brytpunkten, resten utdelning', c.toThreshold], ['Bästa fördelningen', c.best]] as const : [];
  const bestNet = c ? Math.max(...rows.map(([, s]) => s.net)) : 0;
  return (
    <div className="stack">
      <div className="row">
        <label>Vinst att ta ut (före lön, avgifter och skatt)<input value={profit} onChange={(e) => setProfit(e.target.value)} inputMode="decimal" /></label>
        <label style={{ flex: '0 0 160px' }}>Kommunalskatt (%)<input value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" /></label>
      </div>
      {c && (
        <div className="table-wrap"><table className="payout">
          <thead><tr><th></th><th className="num">Lön</th><th className="num">Utdelning</th><th className="num">Avgifter och skatter</th><th className="num">Kvar till dig</th></tr></thead>
          <tbody>{rows.map(([label, s]) => (
            <tr key={label} className={s.net === bestNet ? 'best' : ''}>
              <td>{label}{s.net === bestNet && <span className="badge ok" style={{ marginLeft: 6 }}>Mest kvar</span>}</td>
              <td className="num">{krs(s.salary)}</td><td className="num">{krs(s.dividend)}</td>
              <td className="num">{krs(s.employerFee + s.corporateTax + s.incomeTax + s.dividendTax)}</td><td className="num"><b>{krs(s.net)}</b></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted" style={{ margin: 0 }}>Förenklad beräkning: arbetsgivaravgift 31,42 %, bolagsskatt 20,6 %, statlig skatt 20 % över brytpunkten ({krs(threshold)}), utdelning inom gränsbeloppet ({krs(limit)}) beskattas med 20 % och över det som lön. Grundavdrag och jobbskatteavdrag är inte med – de gör lönen något billigare. Lön ger också pensionsrätt och ökar nästa års lönebaserade utrymme.</p>
    </div>
  );
}
