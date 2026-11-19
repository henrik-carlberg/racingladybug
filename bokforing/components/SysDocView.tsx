import type { SysDoc } from '@/lib/services/sysdoc';
import { sysdocHtml } from '@/lib/sysdoc-html';

/** Systemdokumentationen – samma HTML som i arkivpaketet (alla värden escapas i sysdocHtml) */
export function SysDocView({ d }: { d: SysDoc }) {
  return <div dangerouslySetInnerHTML={{ __html: sysdocHtml(d) }} />;
}
