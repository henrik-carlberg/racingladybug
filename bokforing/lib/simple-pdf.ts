// Enkel PDF med text (A4, Helvetica, WinAnsi – räcker för svenska tecken). Används för fakturor och lönebesked till digitala brevlådor.

export interface PdfLine { text: string; size?: number; bold?: boolean; x?: number; gap?: number; right?: number }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]/g, ' ');
// Ungefärlig bredd för högerställd text (Helvetica, tecken ≈ 0,5 em)
const width = (s: string, size: number) => s.length * size * 0.5;

export function textPdf(lines: PdfLine[], title = 'Dokument'): Buffer {
  const pages: string[][] = [[]];
  let y = 800;
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= l.gap ?? size * 1.5;
    if (y < 50) { pages.push([]); y = 800 - size * 1.5; }
    if (!l.text) continue;
    const font = l.bold ? 'F2' : 'F1';
    const x = l.right != null ? l.right - width(l.text, size) : (l.x ?? 50);
    pages[pages.length - 1].push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(l.text)}) Tj ET`);
    if (l.right != null && l.x != null) { /* kolumn till vänster ritas av anroparen */ }
  }
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const p of pages) {
    const content = p.join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(title)}) /Producer (Bokforing) >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
