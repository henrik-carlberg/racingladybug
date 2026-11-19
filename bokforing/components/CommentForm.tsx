'use client';
import { useLayoutEffect, useRef, useState } from 'react';

/** Kommentarsfält: skriv @ för att nämna någon (listan visar matchande namn) */
export function CommentForm({ action, people, back }: { action: (fd: FormData) => Promise<void>; people: { id: number; name: string }[]; back: string }) {
  const [body, setBody] = useState('');
  const [q, setQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  // Markören hamnar direkt efter det infogade namnet (innan nästa tangenttryck)
  useLayoutEffect(() => {
    if (caret.current != null && ref.current) { ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; }
  }, [body]);
  const matches = q === null ? [] : people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  const onChange = (v: string) => {
    setBody(v);
    const pos = ref.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(v.slice(0, pos));
    setQ(m ? m[2] : null); setSel(0);
  };
  const pick = (name: string) => {
    const el = ref.current; if (!el) return;
    const pos = el.selectionStart ?? body.length;
    const before = body.slice(0, pos).replace(/@([\p{L}\p{N} ]{0,30})$/u, `@${name} `);
    const v = before + body.slice(pos);
    caret.current = before.length;
    setBody(v); setQ(null);
    el.focus();
  };
  return (
    <form action={action} className="comment-form">
      <input type="hidden" name="back" value={back} />
      <div style={{ position: 'relative' }}>
        <textarea ref={ref} name="body" rows={2} value={body} required placeholder="Skriv en kommentar … skriv @ för att nämna någon" aria-label="Kommentar"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (!matches.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, matches.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[sel].name); }
            if (e.key === 'Escape') setQ(null);
          }} />
        {matches.length > 0 && (
          <ul className="mention-list" role="listbox">
            {matches.map((p, i) => <li key={p.id} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p.name); }}>@{p.name}</li>)}
          </ul>
        )}
      </div>
      <div><button className="secondary">Skicka kommentar</button></div>
    </form>
  );
}
