import { GLOSSARY } from '@/lib/glossary';

/** Liten "?" som visar en förklaring av ett begrepp */
export function Help({ term }: { term: keyof typeof GLOSSARY | string }) {
  const g = GLOSSARY[term];
  if (!g) return null;
  return (
    <details className="help">
      <summary aria-label={`Vad betyder ${g.title}?`} title={`Vad betyder ${g.title}?`}>?</summary>
      <div className="help-pop" role="tooltip"><b>{g.title}</b>{g.text}</div>
    </details>
  );
}
