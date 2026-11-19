import Link from 'next/link';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { firmClients, firmMembers, myFirms } from '@/lib/services/firms';
import { createFirm, invite, removeMember, rotateCode, setResponsible } from './actions';

export const dynamic = 'force-dynamic';

export default async function FirmPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const firms = await myFirms(user.id);
  const firm = firms.find((f) => String(f.id) === sp.f) ?? firms[0];
  if (!firm) {
    return (
      <div className="center" style={{ maxWidth: 640 }}>
        <h1>Byråvy för redovisningskonsulter</h1>
        <Flash searchParams={searchParams} />
        <p className="muted">Samla alla dina klienter på ett ställe: obokade banktransaktioner, fakturor i inkorgen, deadlines och frågor till kunden. Klienterna ger byrån åtkomst med byråns kod, och du och dina kollegor arbetar i deras bokföring som redovisningskonsulter.</p>
        <form action={createFirm} className="card stack">
          <label>Byråns namn<input name="name" required /></label>
          <label>Organisationsnummer<input name="orgnr" /></label>
          <div><button>Skapa byrå</button></div>
        </form>
        <p><Link href="/">Tillbaka till mina bolag</Link></p>
      </div>
    );
  }
  const [clients, members] = await Promise.all([firmClients(firm.id, user.id), firmMembers(firm.id)]);
  const mine = sp.mina === '1';
  const shown = mine ? clients.filter((c) => c.responsible === user.id) : clients;
  const owner = firm.role === 'owner';
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="header">
        <h1>{firm.name}</h1>
        <div className="actions" style={{ margin: 0 }}>
          {firms.length > 1 && firms.map((f) => <Link key={f.id} className={`btn ${f.id === firm.id ? '' : 'secondary'}`} href={`/byra?f=${f.id}`}>{f.name}</Link>)}
          <Link className="btn" href={`/byra/manad?f=${firm.id}`}>Månadsbokslut</Link>
          <Link className="btn secondary" href={`/byra/tid?f=${firm.id}`}>Byråns tid</Link>
          <Link className="btn secondary" href="/">Mina bolag</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="card small">Byråns kod: <code className="firm-code" style={{ fontSize: '1.1em' }}>{firm.code}</code> – klienten anger koden under Inställningar → Redovisningsbyrå för att ge er åtkomst.
        {owner && <form action={rotateCode.bind(null, firm.id)} style={{ display: 'inline', marginLeft: '.5rem' }}><button className="link">Ny kod</button></form>}</div>

      <div className="header"><h2>Klienter ({clients.length})</h2>
        <div className="actions" style={{ margin: 0 }}><Link className={`btn ${mine ? 'secondary' : ''}`} href={`/byra?f=${firm.id}`}>Alla</Link><Link className={`btn ${mine ? '' : 'secondary'}`} href={`/byra?f=${firm.id}&mina=1`}>Mina</Link></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Klient</th><th className="num">Att göra</th><th className="num">Bank</th><th className="num">Inkorg</th><th>Frågor</th><th>Nästa deadline</th><th>Senast bokfört</th><th>Ansvarig</th></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/c/${c.id}`}><b>{c.name}</b></Link><div className="small muted">{c.orgnr}</div></td>
              <td className="num">{c.urgent > 0 ? <span className="badge warn">{c.urgent}</span> : '–'}</td>
              <td className="num">{c.bank ? <Link href={`/c/${c.id}/bank/avstamning`}>{c.bank}</Link> : '–'}</td>
              <td className="num">{c.inbox ? <Link href={`/c/${c.id}/leverantorsfakturor/inkorg`}>{c.inbox}</Link> : '–'}</td>
              <td className="small">{c.openQuestions || c.answered ? <Link href={`/c/${c.id}/fragor`}>{c.openQuestions} obesvarade{c.answered ? `, ${c.answered} nya svar` : ''}</Link> : '–'}</td>
              <td className="small">{c.overdue > 0 && <span className="badge danger">{c.overdue} försenad</span>} {c.nextDeadline && <>{c.nextDeadline.due} {c.nextDeadline.title}</>}</td>
              <td className="small">{c.lastVoucher ?? '–'}</td>
              <td>
                <form action={setResponsible.bind(null, firm.id, c.id)} className="row" style={{ flexWrap: 'nowrap', gap: '.3rem' }}>
                  <select name="responsible" defaultValue={c.responsible ?? ''} aria-label="Ansvarig"><option value="">–</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select>
                  <button className="link small">Spara</button>
                </form>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={8} className="muted">Inga klienter ännu. Ge klienten byråns kod.</td></tr>}
        </tbody>
      </table></div>

      <h2>Kollegor</h2>
      <table className="small"><tbody>{members.map((m) => (
        <tr key={m.user_id}><td>{m.name}</td><td>{m.email}</td><td>{m.role === 'owner' ? 'Ägare' : 'Konsult'}</td>
          <td className="num">{owner && m.role !== 'owner' && <form action={removeMember.bind(null, firm.id, m.user_id)}><button className="link">Ta bort</button></form>}</td></tr>
      ))}</tbody></table>
      {owner && (
        <form action={invite.bind(null, firm.id)} className="row" style={{ alignItems: 'end', maxWidth: 560 }}>
          <label>Bjud in kollega (e-post)<input name="email" type="email" required /></label>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Skapa inbjudan</button></div>
        </form>
      )}
    </div>
  );
}
