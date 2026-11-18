'use client';
import { useState } from 'react';

type Turn = { role: 'user' | 'assistant'; content: string };
const EXAMPLES = ['Hur gick förra månaden jämfört med samma månad i fjol?', 'Vilka kunder är sena med betalningen?', 'Vad är våra största kostnader i år?', 'Hur mycket moms ska vi betala?'];

export function Assistant({ ask }: { ask: (turns: Turn[]) => Promise<{ answer?: string; error?: string }> }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next); setQ(''); setBusy(true); setError('');
    try {
      const r = await ask(next);
      if (r.answer) setTurns([...next, { role: 'assistant', content: r.answer }]);
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
