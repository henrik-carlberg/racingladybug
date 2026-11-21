import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { candidates, history } from '@/lib/services/netting';
import { offsetAction } from './actions';

export const dynamic = 'force-dynamic';

/** Kvittning av kundfordringar mot leverantörsskulder hos samma motpart */
export default async function Netting({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payments' });
  const [c, h] = await Promise.all([candidates(company.id), history(company.id)]);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Kvittning och nettning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">När en motpart både är kund och leverantör kan fordran och skulden kvittas mot varandra i stället för att pengar skickas åt båda hållen.
        Kvittning förutsätter att båda fordringarna är förfallna eller att det finns ett kvittningsavtal; spara avtalet eller hänvisningen som dokumentation.
        Fakturorna matchas på organisationsnummer. ROT/RUT-fakturor, belånade fakturor och leverantörsfakturor med en pågående bankbetalning kvittas inte; koncernbolag markeras så att koncerninterna mellanhavanden kan nettas regelbundet.</p>
      {!c.length && <p className="muted kv-none">Ingen motpart har just nu både en obetald kundfaktura och en attesterad leverantörsfaktura.</p>}
      {c.map((x) => (
        <form key={x.orgnr} action={offsetAction.bind(null, company.id)} className="card kv-cand" style={{ marginBottom: '1rem' }}>
          <h3>{x.name} <span className="small muted">{x.orgnr}</span>{x.group && <span className="badge"> Koncernbolag</span>}</h3>
          <p>Kundfordran <strong>{kr(x.receivable)}</strong>, leverantörsskuld <strong>{kr(x.payable)}</strong>. Kvittas: <strong className="kv-total">{kr(x.total)}</strong>,
            kvar att {x.receivable > x.payable ? `få betalt ${kr(x.receivable - x.total)}` : `betala ${kr(x.payable - x.total)}`}.</p>
          <input type="hidden" name="orgnr" value={x.orgnr} />
          <div className="row">
            <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
            <label style={{ flex: 1 }}>Kvittningsavtal eller hänvisning<input name="agreement" maxLength={500} placeholder="T.ex. avtal 2026-01-15, bekräftat via e-post" /></label>
            <div style={{ flex: '0 0 auto' }}><button>Bokför kvittning</button></div>
          </div>
        </form>
      ))}
      {h.length > 0 && <><h2>Genomförda kvittningar</h2>
        <table className="kv-hist"><tbody>{h.map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.orgnr}</td><td className="num">{kr(r.amount)}</td></tr>)}</tbody></table></>}
    </div>
  );
}
