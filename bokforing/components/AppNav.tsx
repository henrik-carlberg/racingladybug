'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { NavItem, NavSection } from '@/lib/nav';

/** Knapp som inte är ett <button> (så att sidornas knappar inte förväxlas med menyns) men fungerar med tangentbord */
const press = (fn: () => void) => ({ role: 'button', tabIndex: 0, onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } } });

/** Den mest specifika menyraden som matchar adressen är aktiv */
function activeHref(path: string, hrefs: string[], home: string) {
  return hrefs.filter((h) => path === h || (h !== home && path.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0] ?? '';
}

const ICON_TOP: Record<number, string> = { 0: 'home', 1: 'receipt', 2: 'sparkles' };

export function SideNav({ top, sections, badge, extra }: { top: NavItem[]; sections: NavSection[]; badge?: number; extra: NavItem[] }) {
  const path = usePathname();
  const all = [...top, ...sections.flatMap((s) => s.items), ...extra];
  const active = activeHref(path, all.map((x) => x.href), top[0]?.href ?? '');
  const activeSection = sections.find((s) => s.items.some((i) => i.href === active))?.id;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setOpen(JSON.parse(localStorage.getItem('nav-open') ?? '{}')); } catch { /* ingen lagring */ }
  }, []);
  const toggle = (id: string) => setOpen((o) => {
    const n = { ...o, [id]: !(o[id] ?? id === activeSection) };
    try { localStorage.setItem('nav-open', JSON.stringify(n)); } catch { /* ingen lagring */ }
    return n;
  });
  const link = (x: NavItem, icon?: string, count?: number) => (
    <Link key={x.href} href={x.href} className={x.href === active ? 'nav-link active' : 'nav-link'} aria-current={x.href === active ? 'page' : undefined} title={x.hint}>
      {icon && <Icon name={icon} />}<span>{x.label}</span>{count ? <span className="nav-count" title={x.hint}>{count}</span> : null}
    </Link>
  );
  return (
    <nav aria-label="Huvudmeny">
      <div className="nav-top">{top.map((x, i) => link(x, ICON_TOP[i], i === 0 ? badge : undefined))}</div>
      {sections.map((s) => {
        const isOpen = open[s.id] ?? s.id === activeSection;
        return (
          <div key={s.id} className={isOpen ? 'nav-section open' : 'nav-section'}>
            <div className="nav-head" aria-expanded={isOpen} {...press(() => toggle(s.id))}>
              <Icon name={s.icon} /><span>{s.label}</span><Icon name="chevron" className="chev" size={14} />
            </div>
            <div className="nav-items">{s.items.map((x) => link(x))}</div>
          </div>
        );
      })}
      <div className="nav-foot">{extra.map((x) => link(x))}</div>
    </nav>
  );
}

/** Sök och gå till (Ctrl+K eller /): alla sidor och snabbval, sök på namn eller beskrivning */
export function CommandPalette({ items, create, placeholder, createLabel }: { items: NavItem[]; create: NavItem[]; placeholder: string; createLabel: string }) {
  const [show, setShow] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setShow(true); }
      if (e.key === 'Escape') setShow(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (show) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [show]);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');
  const list = useMemo(() => {
    const all = [...create.map((x) => ({ ...x, kind: 'create' as const })), ...items.map((x) => ({ ...x, kind: 'page' as const }))];
    const words = norm(q).split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    return all.filter((x) => {
      if (seen.has(x.href + x.label)) return false;
      seen.add(x.href + x.label);
      const hay = norm(`${x.label} ${x.hint ?? ''}`);
      return words.every((w) => hay.includes(w));
    }).slice(0, 12);
  }, [q, items, create]);
  const go = (x: NavItem | undefined) => { if (!x) return; setShow(false); router.push(x.href); };
  return (
    <>
      <div className="search-trigger" aria-label={placeholder} {...press(() => setShow(true))}>
        <Icon name="search" /><span>{placeholder}</span><kbd>Ctrl K</kbd>
      </div>
      {show && (
        <div className="palette-backdrop" onClick={() => setShow(false)}>
          <div className="palette" role="dialog" aria-modal="true" aria-label={placeholder} onClick={(e) => e.stopPropagation()}>
            <div className="palette-input"><Icon name="search" />
              <input ref={input} value={q} placeholder={placeholder} aria-label={placeholder} onChange={(e) => { setQ(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  if (e.key === 'Enter') { e.preventDefault(); go(list[sel]); }
                }} />
            </div>
            <ul role="listbox">
              {list.map((x, i) => (
                <li key={x.href + x.label} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(x)}>
                  <Icon name={x.kind === 'create' ? 'plus' : 'arrow'} />
                  <span><b>{x.label}</b>{x.hint && <span className="muted"> – {x.hint}</span>}</span>
                  {x.kind === 'create' && <span className="tag">{createLabel}</span>}
                </li>
              ))}
              {list.length === 0 && <li className="muted empty">Inget hittades</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/** Knappen "Skapa" med de vanligaste sakerna man lägger upp */
export function CreateMenu({ items, label }: { items: NavItem[]; label: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShow(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="create-menu" ref={ref}>
      <div className="create-btn" aria-expanded={show} aria-haspopup="menu" {...press(() => setShow((s) => !s))}><Icon name="plus" /><span>{label}</span></div>
      {show && (
        <div className="menu" role="menu">
          {items.map((x) => (
            <Link key={x.href + x.label} href={x.href} role="menuitem" onClick={() => setShow(false)}>
              <b>{x.label}</b>{x.hint && <span className="muted small">{x.hint}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
