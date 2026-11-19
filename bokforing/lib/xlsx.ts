// Excel-arbetsböcker (xlsx) med riktiga tal, kolumnbredder och fet rubrikrad. Ren logik.
import { zip } from './zip';

export type Cell = string | number | null | { v: number; fmt?: 'kr' | 'int' | 'pct' } | { s: string; bold?: boolean };
export interface Sheet { name: string; rows: Cell[][]; widths?: number[]; header?: boolean }

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => (/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ? s.replace(/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => ESC[c] ?? '') : s);
const col = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Stilar: 0 normal, 1 fet, 2 kronor (#,##0.00), 3 heltal, 4 procent, 5 fet kronor
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(c: Cell, ref: string, bold: boolean): string {
  if (c === null || c === undefined || c === '') return '';
  if (typeof c === 'number') return `<c r="${ref}" s="${bold ? 5 : 2}"><v>${c}</v></c>`;
  if (typeof c === 'string') return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  if ('v' in c) return `<c r="${ref}" s="${c.fmt === 'int' ? 3 : c.fmt === 'pct' ? 4 : bold ? 5 : 2}"><v>${Number.isFinite(c.v) ? c.v : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${c.bold || bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(c.s)}</t></is></c>`;
}

function sheetXml(s: Sheet): string {
  const widths = s.widths ?? s.rows.reduce<number[]>((w, r) => { r.forEach((c, i) => { const len = typeof c === 'string' ? c.length : c && typeof c === 'object' && 's' in c ? c.s.length : 12; w[i] = Math.min(60, Math.max(w[i] ?? 8, len + 2)); }); return w; }, []);
  const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => cellXml(c, `${col(ci)}${ri + 1}`, !!s.header && ri === 0)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

/** Arbetsbok som Buffer. Bladnamn får högst 31 tecken och inte innehålla : \\ / ? * [ ] */
export function workbook(sheets: Sheet[]): Buffer {
  const names = sheets.map((s, i) => (s.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || `Blad${i + 1}`));
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Öre → kronor som tal */
export const kronor = (ore: number) => ({ v: Math.round(ore) / 100, fmt: 'kr' as const });
