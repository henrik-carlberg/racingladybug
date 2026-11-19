'use client';
import { useRouter } from 'next/navigation';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/** Hur länge man kan ångra innan åtgärden genomförs */
export const UNDO_MS = 6000;

type Result = { error?: string } | void;
interface Op { id: number; message: string; run: () => Promise<Result>; restore?: () => void; started: number }
const Ctx = createContext<{ push: (op: Omit<Op, 'id' | 'started'>) => void } | null>(null);

/**
 * Åtgärder som kan ångras: de genomförs först efter några sekunder. Ligger i bolagets layout och lever kvar
 * när man byter sida, så att åtgärden blir av även om man går vidare.
 */
export function UndoProvider({ children, undoLabel = 'Ångra' }: { children: React.ReactNode; undoLabel?: string }) {
  const [ops, setOps] = useState<Op[]>([]);
  const [error, setError] = useState('');
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<number, Op>());
  const router = useRouter();
  const execute = useCallback(async (op: Op) => {
    timers.current.delete(op.id);
    pending.current.delete(op.id);
    setOps((o) => o.filter((x) => x.id !== op.id));
    try {
      const r = await op.run();
      if (r && r.error) { op.restore?.(); setError(r.error); }
    } catch { op.restore?.(); setError('Något gick fel'); }
    router.refresh();
  }, [router]);
  const push = useCallback((o: Omit<Op, 'id' | 'started'>) => {
    const op: Op = { ...o, id: Date.now() + Math.random(), started: Date.now() };
    pending.current.set(op.id, op);
    setOps((x) => [...x, op]);
    setError('');
    timers.current.set(op.id, setTimeout(() => execute(op), UNDO_MS));
  }, [execute]);
  const undo = (op: Op) => {
    clearTimeout(timers.current.get(op.id));
    timers.current.delete(op.id);
    pending.current.delete(op.id);
    op.restore?.();
    setOps((o) => o.filter((x) => x.id !== op.id));
  };
  // Stängs fliken: genomför direkt i stället för att tappa åtgärden
  useEffect(() => {
    const flush = () => { for (const op of pending.current.values()) { clearTimeout(timers.current.get(op.id)); void op.run(); } pending.current.clear(); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite">
        {ops.map((op) => (
          <div key={op.id} className="toast">
            <span>{op.message}</span>
            <button type="button" className="toast-undo" onClick={() => undo(op)}>{undoLabel}</button>
            <span className="toast-bar" style={{ animationDuration: `${UNDO_MS}ms` }} />
          </div>
        ))}
        {error && <div className="toast error" role="alert"><span>{error}</span><button type="button" className="toast-undo" onClick={() => setError('')}>OK</button></div>}
      </div>
    </Ctx.Provider>
  );
}

/**
 * Knapp för en åtgärd som kan ångras. Raden den står i döljs direkt, åtgärden körs efter några sekunder.
 * `after`: sida att gå till direkt (t.ex. listan när man tar bort ett utkast från dess egen sida).
 */
export function UndoButton({ action, message, children, after, className = 'link' }: {
  action: () => Promise<Result>; message: string; children: React.ReactNode; after?: string; className?: string;
}) {
  const ctx = useContext(Ctx);
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const click = () => {
    if (!ctx) { void action().then(() => router.refresh()); return; }
    const row = ref.current?.closest<HTMLElement>('[data-undo-row], tr, li');
    const prev = row?.style.display ?? '';
    if (row && !after) row.style.display = 'none';
    ctx.push({ message, run: action, restore: () => { if (row) row.style.display = prev; } });
    if (after) router.push(after);
  };
  return <button type="button" ref={ref} className={className} onClick={click}>{children}</button>;
}
