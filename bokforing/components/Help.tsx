import { GLOSSARY } from '@/lib/glossary';

/** Liten "?" som visar en förklaring av ett begrepp */
export function Help({ term }: { term: keyof typeof GLOSSARY | string }) {
  const g = GLOSSARY[term];
  if (!g) return null;
  return (
    <details className="help" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
      <summary aria-label={`Vad betyder ${g.title}?`} style={{ listStyle: 'none', cursor: 'pointer', display: 'inline-flex', width: 18, height: 18, borderRadius: 9,
        border: '1px solid var(--border)', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>?</summary>
      <div className="card small" style={{ position: 'absolute', zIndex: 20, maxWidth: 340, marginTop: 4, fontWeight: 'normal', color: 'var(--text)' }}>
        <b>{g.title}</b><br />{g.text}
      </div>
    </details>
  );
}
