import Link from 'next/link';
import { PublicHeader } from '@/components/PublicHeader';
import { currentUser } from '@/lib/server/auth';
import { HELP, helpGroups } from '@/lib/help';
import { APP_NAME } from '@/lib/brand';

export const metadata = { title: `Hjälp – ${APP_NAME}` };

export default async function Help({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await currentUser();
  const q = ((await searchParams).q ?? '').trim().toLowerCase();
  const hits = q ? HELP.filter((a) => (a.title + ' ' + a.body).toLowerCase().includes(q)) : HELP;
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 3rem' }}>
      <PublicHeader loggedIn={!!user} />
      <h1>Hjälp</h1>
      <form className="row" style={{ alignItems: 'end', maxWidth: 520 }}><label>Sök i hjälpen<input name="q" defaultValue={q} placeholder="T.ex. moms, lön, ROT" /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Sök</button></div></form>
      {helpGroups().map((g) => {
        const list = hits.filter((a) => a.group === g);
        if (!list.length) return null;
        return <section key={g}><h2>{g}</h2><ul>{list.map((a) => <li key={a.slug}><Link href={`/hjalp/${a.slug}`}>{a.title}</Link></li>)}</ul></section>;
      })}
      {hits.length === 0 && <p className="muted">Inga artiklar matchar sökningen.</p>}
      <p className="small muted">Hittar du inte svaret? Kontakta oss{process.env.PROVIDER_EMAIL ? ` på ${process.env.PROVIDER_EMAIL}` : ''}.</p>
    </div>
  );
}
