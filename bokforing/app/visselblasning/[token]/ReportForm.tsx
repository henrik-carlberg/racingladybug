'use client';
import { useActionState } from 'react';
import { CATEGORIES } from '@/lib/whistleblowing';
import { submitAction, type SubmitState } from './actions';

export default function ReportForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitAction.bind(null, token), {});
  if (state.code) return (
    <div className="card stack wb-done">
      <b>Tack, din rapport är mottagen.</b>
      <p>Din ärendekod är <code className="wb-code">{state.code}</code></p>
      <p className="small">Spara koden – den visas bara nu och kan inte återskapas. Med koden kan du följa ärendet, svara på frågor och få återkoppling utan att lämna ut vem du är.</p>
    </div>);
  return (
    <form action={action} className="card stack wb-form">
      {state.error && <p className="flash error" role="alert">{state.error}</p>}
      <label>Vad gäller rapporten?<select name="category">{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Beskriv vad som har hänt, när och vilka som är inblandade<textarea name="body" rows={8} required minLength={20} maxLength={20000} /></label>
      <label>Kontaktuppgift (frivilligt – lämna tomt för att vara anonym)<input name="contact" maxLength={300} autoComplete="off" /></label>
      <div><button disabled={pending}>Skicka rapport</button></div>
    </form>);
}
