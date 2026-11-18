import Link from 'next/link';

export function PublicHeader({ loggedIn = false }: { loggedIn?: boolean }) {
  return (
    <header className="public-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '1rem 0' }}>
      <Link href="/" style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--text)' }}>Bokföring</Link>
      <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href="/priser">Priser</Link>
        <Link href="/hjalp">Hjälp</Link>
        {loggedIn ? <Link className="btn" href="/">Mina bolag</Link> : <><Link href="/login">Logga in</Link><Link className="btn" href="/register">Prova gratis</Link></>}
      </nav>
    </header>
  );
}
