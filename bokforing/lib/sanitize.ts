// Strikt HTML-sanering för dokument (vitlista). Alla attribut tas bort utom colspan/rowspan,
// så att skript, händelsehanterare, länkar och inbäddat innehåll inte kan köras.
const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'hr', 'small', 'blockquote']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|svg|math|textarea|select|title|head)\b[\s\S]*?<\/\1\s*>/gi;

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_WITH_CONTENT, '')
    .replace(/<\/?([a-zA-Z0-9]+)\b([^>]*)>/g, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return '';
      if (m.startsWith('</')) return `</${t}>`;
      const keep = [...attrs.matchAll(/\b(colspan|rowspan)\s*=\s*["']?(\d{1,2})["']?/gi)].map((a) => ` ${a[1].toLowerCase()}="${a[2]}"`).join('');
      return `<${t}${keep}>`;
    })
    .replace(/<(?![a-z/])/gi, '&lt;');
}
