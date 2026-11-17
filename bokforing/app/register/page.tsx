import { register } from '../auth-actions';
import { Flash, type SP } from '@/components/ui';

export default function Register({ searchParams }: { searchParams: SP }) {
  return (
    <div className="center">
      <h1>Skapa ägarkonto</h1>
      <p className="muted">Det första kontot blir ägare. Fler användare, till exempel din redovisningskonsult, bjuder du in från bolagets inställningar.</p>
      <Flash searchParams={searchParams} />
      <form action={register} className="card stack">
        <label>Namn<input name="name" required /></label>
        <label>E-post<input name="email" type="email" required /></label>
        <label>Lösenord (minst 10 tecken)<input name="password" type="password" minLength={10} required /></label>
        <button>Skapa konto</button>
      </form>
    </div>
  );
}
