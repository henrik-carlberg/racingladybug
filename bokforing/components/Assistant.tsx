'use client';
import { useState } from 'react';

type Turn = { role: 'user' | 'assistant'; content: string };
type Suggestion = { type: 'remind' | 'match_bank' | 'open'; label: string; invoice_number: number | null; bank_transaction_id: number | null; path: string | null };
const EXAMPLES = ['Hur gick förra månaden jämfört med samma månad i fjol?', 'Vilka kunder är sena med betalningen?', 'Vad är våra största kostnader i år?', 'Hur mycket moms ska vi betala?'];

export function Assistant({ ask, run, base }: { ask: (turns: Turn[]) => Promise<{ answer?: string; actions?: Suggestion[]; error?: string }>; run: (a: Suggestion) => Promise<{ ok?: string; error?: string }>; base: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<Record<number, Suggestion[]>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next); setQ(''); setBusy(true); setError('');
    try {
      const r = await ask(next);
      if (r.answer) { setTurns([...next, { role: 'assistant', content: r.answer }]); setActions((m) => ({ ...m, [next.length]: r.actions ?? [] })); }
      else { setError(r.error ?? 'Något gick fel'); setTurns(turns); setQ(question); }
    } catch { setError('Något gick fel'); setTurns(turns); setQ(question); }
    setBusy(false);
  };
  return (
    <div className="stack">
      {turns.length === 0 && (
        <div className="actions">{EXAMPLES.map((e) => <button key={e} type="button" className="secondary" onClick={() => send(e)}>{e}</button>)}</div>
      )}
      {turns.map((t, i) => (
        <div key={i} className={`card assistant-${t.role}`} style={t.role === 'user' ? { marginLeft: '15%', background: 'var(--bg-soft, #f4f6f8)' } : { marginRight: '10%' }}>
          <div className="small muted">{t.role === 'user' ? 'Du' : 'Assistenten'}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.content}</div>
          {(actions[i] ?? []).length > 0 && (
            <div className="actions assistant-actions" style={{ marginTop: '.5rem' }}>
              {actions[i].map((a, j) => {
                const key = `${i}:${j}`;
                if (a.type === 'open' && a.path) return <a key={key} className="btn secondary" href={`${base}${a.path}`}>{a.label}</a>;
                return results[key] ? <span key={key} className="small">{results[key]}</span> : (
                  <button key={key} type="button" className="secondary" onClick={async () => {
                    const r = await run(a);
                    setResults((m) => ({ ...m, [key]: r.ok ? `✓ ${r.ok}` : `⚠️ ${r.error}` }));
                  }}>{a.label}</button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {busy && <p className="muted">Assistenten tänker…</p>}
      {error && <div className="flash error">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '1 1 400px' }}>Fråga<textarea name="q" rows={2} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q); } }} placeholder="T.ex. Varför är resultatet lägre i oktober?" /></label>
        <div style={{ flex: '0 0 auto' }}><button disabled={busy || !q.trim()}>Fråga</button></div>
      </form>
    </div>
  );
}
