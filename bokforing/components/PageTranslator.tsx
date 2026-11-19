'use client';
import { useEffect } from 'react';

/**
 * Översätter sidans svenska texter till engelska i webbläsaren när användaren valt engelska.
 * Textnoder och attribut (placeholder, title, aria-label) som finns i ordlistan byts ut, även när sidan ändras senare.
 * Texter som inte finns i ordlistan visas på svenska.
 */
export function PageTranslator() {
  useEffect(() => {
    let dict: Record<string, string> = {};
    let patterns: [RegExp, string | ((...g: string[]) => string)][] = [];
    let observer: MutationObserver | null = null;
    let stopped = false;
    const ATTRS = ['placeholder', 'title', 'aria-label'];
    const look = (raw: string): string | null => {
      const t = raw.replace(/\s+/g, ' ').trim();
      if (!t || t.length > 400) return null;
      const hit = dict[t];
      if (hit) return hit;
      for (const [re, to] of patterns) if (re.test(t)) return typeof to === 'string' ? t.replace(re, to) : t.replace(re, to as (...g: string[]) => string);
      return null;
    };
    const textNode = (n: Text) => {
      const v = n.nodeValue ?? '';
      const en = look(v);
      if (en == null) return;
      const lead = v.match(/^\s*/)![0], trail = v.match(/\s*$/)![0];
      const next = lead + en + trail;
      if (next !== v) n.nodeValue = next;
    };
    const element = (el: Element) => {
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const en = look(v); if (en && en !== v) el.setAttribute(a, en); } }
      if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button') && el.value) { const en = look(el.value); if (en) el.value = en; }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (el.closest('script,style,code,pre,textarea,[data-no-translate]')) return;
      element(el);
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches('script,style,code,pre,textarea,[data-no-translate]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === Node.TEXT_NODE ? textNode(n as Text) : element(n as Element);
    };
    Promise.all([import('@/lib/ui-en-pages'), import('@/lib/ui-i18n')]).then(([p, u]) => {
      if (stopped) return;
      dict = { ...p.PAGES_EN, ...u.UI_EN };
      patterns = p.PATTERNS_EN;
      walk(document.body);
      if (document.title) { const en = look(document.title); if (en) document.title = en; }
      document.documentElement.classList.remove('i18n-pending');
      observer = new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.type === 'characterData') textNode(m.target as Text);
          else if (m.type === 'attributes') element(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }).catch(() => document.documentElement.classList.remove('i18n-pending'));
    return () => { stopped = true; observer?.disconnect(); };
  }, []);
  return null;
}
