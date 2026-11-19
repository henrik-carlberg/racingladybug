import type { ReactNode } from 'react';
import Link from 'next/link';
import { kr } from '@/lib/format';
import { Help } from './Help';
import { Icon } from './Icon';

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

export function Header({ title, children, help }: { title: string; children?: ReactNode; help?: string }) {
  return (
    <div className="header">
      <h1>{title}{help && <Help term={help} />}</h1>
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

/** Tom sida: vad man gör först, med de viktigaste knapparna */
export function EmptyState({ icon = 'sparkles', title, children, actions = [] }: {
  icon?: string; title: string; children?: ReactNode; actions?: { href: string; label: string; secondary?: boolean }[];
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions.length > 0 && <div className="actions">{actions.map((a) => <Link key={a.href} className={a.secondary ? 'btn secondary' : 'btn'} href={a.href}>{a.label}</Link>)}</div>}
    </div>
  );
}
