import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { integrationStatus } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/** Bolagets kopplingar: vad som fungerar, vad som saknas och var man fixar det */
export default async function Status({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(cid);
  const b = `/c/${company.id}`;
  const g = Object.fromEntries(integrationStatus(process.env).map((i) => [i.key, i.configured]));
  const [c] = await sql<{ bank: number; expired: number; ag: string; bg: string; devices: number; bankid: boolean; inbox: string | null; vat: string }[]>`
    SELECT (SELECT count(*)::int FROM bank_connections WHERE company_id = ${company.id} AND status = 'active') AS bank,
      (SELECT count(*)::int FROM bank_connections WHERE company_id = ${company.id} AND status IN ('expired','error')) AS expired,
      co.autogiro_customer_no AS ag, co.bankgiro AS bg, co.vat_number AS vat, co.inbox_token AS inbox,
      (SELECT count(*)::int FROM push_subscriptions WHERE user_id = ${user.id}) AS devices,
      (SELECT bankid_pnr_hash IS NOT NULL FROM users WHERE id = ${user.id}) AS bankid
    FROM companies co WHERE co.id = ${company.id}`;
  type Row = [string, 'ok' | 'todo' | 'off', string, string?, string?];
  const rows: Row[] = [
    ['Bankgiro för betalningar', c.bg ? 'ok' : 'todo', c.bg ? `Bankgiro ${c.bg} står på fakturorna` : 'Lägg in bankgiro så att kunderna vet vart de ska betala', `${b}/installningar`, 'Inställningar'],
    ['Momsregistreringsnummer', c.vat ? 'ok' : 'todo', c.vat ? c.vat : 'Behövs på fakturor och för EU-handel', `${b}/installningar`, 'Inställningar'],
    ['Bankkoppling', !g.bank ? 'off' : c.expired ? 'todo' : c.bank ? 'ok' : 'todo', !g.bank ? 'Tjänsten har inte slagit på automatisk bankkoppling än – importera kontoutdrag som fil' : c.expired ? 'Kopplingen har gått ut – koppla banken igen med BankID' : c.bank ? 'Transaktionerna hämtas varje natt' : 'Koppla banken så hämtas transaktionerna automatiskt', `${b}/bank`, 'Bank'],
    ['E-post till kunder', g.mail ? 'ok' : 'off', g.mail ? 'Fakturor och påminnelser kan skickas med e-post' : 'E-post är inte uppsatt i tjänsten än – fakturor delas med länk eller PDF'],
    ['Inkorg för leverantörsfakturor', !g.inbox ? 'off' : c.inbox ? 'ok' : 'todo', !g.inbox ? 'Inte uppsatt i tjänsten än – ladda upp fakturor i stället' : c.inbox ? 'Leverantörerna kan mejla fakturor till bolagets adress' : 'Öppna inkorgen så skapas bolagets adress', `${b}/leverantorsfakturor/inkorg`, 'Inkorgen'],
    ['Avläsning med AI', g.ai ? 'ok' : 'off', g.ai ? 'Fakturor och kvitton läses av automatiskt' : 'Inte påslaget i tjänsten än – uppgifterna fylls i för hand'],
    ['Autogiro', c.ag && c.bg ? 'ok' : 'todo', c.ag ? 'Kundnummer hos Bankgirot finns' : 'Valfritt: dra betalningar direkt från kundens konto', `${b}/autogiro`, 'Autogiro'],
    ['BankID för dig', !g.bankid ? 'off' : c.bankid ? 'ok' : 'todo', !g.bankid ? 'BankID är inte uppsatt i tjänsten än' : c.bankid ? 'Du kan logga in och signera med BankID' : 'Koppla BankID för att logga in och signera', '/konto#bankid', 'Mitt konto'],
    ['Notiser i din mobil', !g.push ? 'off' : c.devices ? 'ok' : 'todo', !g.push ? 'Pushnotiser är inte uppsatta i tjänsten än' : c.devices ? `${c.devices} enhet(er) tar emot notiser` : 'Slå på notiser så missar du inget att attestera', '/konto#notiser', 'Mitt konto'],
  ];
  const ICON = { ok: '✓', todo: '!', off: '–' };
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Kopplingar och status</h1>
      <p className="muted">Vad som fungerar för {company.name}, vad som saknas och var du fixar det.</p>
      <div className="stack" style={{ gap: '.5rem' }}>
        {rows.map(([name, st, text, href, label]) => (
          <div key={name} className={`card status-row ${st}`} style={{ margin: 0 }}>
            <span className="status-icon" aria-hidden="true">{ICON[st]}</span>
            <div style={{ flex: 1 }}><b>{name}</b><div className="small muted">{text}</div></div>
            {href && st !== 'off' && <Link className={st === 'todo' ? 'btn' : 'btn secondary'} href={href}>{st === 'todo' ? 'Fixa' : label}</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}
