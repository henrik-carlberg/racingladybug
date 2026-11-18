import Link from 'next/link';
import { unsubscribe } from '@/lib/services/digest';

export const dynamic = 'force-dynamic';

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { token } = await params;
  const { ok } = await searchParams;
  async function confirm() {
    'use server';
    const { redirect } = await import('next/navigation');
    const done = await unsubscribe(token);
    redirect(`/avregistrera/${token}?ok=${done ? '1' : '0'}`);
  }
  return (
    <div className="center" style={{ maxWidth: 520 }}>
      <h1>Sammandrag via e-post</h1>
      {ok === '1' ? <p>Klart – du får inga fler sammandrag. Du kan slå på dem igen under <Link href="/konto">Mitt konto</Link>.</p>
        : ok === '0' ? <p>Länken är ogiltig. Logga in och ändra under <Link href="/konto">Mitt konto</Link>.</p>
        : <form action={confirm} className="card stack"><p>Vill du sluta få sammandrag av det som väntar i dina bolag?</p><div><button>Ja, avsluta sammandragen</button></div></form>}
    </div>
  );
}
