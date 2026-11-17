import { sanitizeHtml } from '@/lib/sanitize';

/** Visar dokumentets innehåll: sanerad HTML eller länk till PDF */
export function DocumentBody({ kind, html, pdfUrl, filename }: { kind: string; html: string | null; pdfUrl: string; filename: string | null }) {
  if (kind === 'pdf') {
    return (
      <div className="stack">
        <object data={pdfUrl} type="application/pdf" style={{ width: '100%', height: '70vh', border: '1px solid var(--border)' }}>
          <a href={pdfUrl} target="_blank">Öppna {filename ?? 'PDF'}</a>
        </object>
        <a href={pdfUrl} target="_blank" className="small">Öppna {filename ?? 'PDF'} i ny flik</a>
      </div>
    );
  }
  return <div className="doc document-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html ?? '') }} />;
}
