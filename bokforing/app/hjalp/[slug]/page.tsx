import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicHeader } from '@/components/PublicHeader';
import { currentUser } from '@/lib/server/auth';
import { HELP } from '@/lib/help';

export function generateStaticParams() { return HELP.map((a) => ({ slug: a.slug })); }

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = HELP.find((x) => x.slug === slug);
  if (!a) notFound();
  const user = await currentUser();
  const blocks = a.body.split(/\n\s*\n/);
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 3rem' }}>
      <PublicHeader loggedIn={!!user} />
      <p className="small"><Link href="/hjalp">← Hjälp</Link> · {a.group}</p>
      <h1>{a.title}</h1>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        return lines.every((l) => l.startsWith('- ')) ? <ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul> : <p key={i}>{b}</p>;
      })}
    </div>
  );
}
