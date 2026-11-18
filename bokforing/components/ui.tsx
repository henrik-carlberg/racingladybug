import type { ReactNode } from 'react';
import { kr } from '@/lib/format';

export type SP = Promise<Record<string, string | string[] | undefined>>;

export async function Flash({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <>
      {sp.error && <div className="flash error" role="alert">{String(sp.error)}</div>}
      {sp.ok && <div className="flash ok" role="status">{String(sp.ok)}</div>}
    </>
  );
}

export function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="header">
      <h1>{title}</h1>
      {children && <div className="actions" style={{ margin: 0 }}>{children}</div>}
    </div>
  );
}

export const Kr = ({ v }: { v: number | null | undefined }) => <>{kr(v)}</>;

const STATUS: Record<string, [string, string]> = {
  draft: ['Utkast', ''],
  booked: ['Bokförd', 'warn'],
  approved: ['Attesterad', 'warn'],
  paid: ['Betald', 'ok'],
  credited: ['Krediterad', 'danger'],
};
export function Status({ s, overdue }: { s: string; overdue?: boolean }) {
  if (overdue && (s === 'booked' || s === 'approved')) return <span className="badge danger">Förfallen</span>;
  const [label, cls] = STATUS[s] ?? [s, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}
