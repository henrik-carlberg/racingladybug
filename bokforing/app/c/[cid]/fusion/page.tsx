import Link from 'next/link';
import { allowedCompanies, requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/merger';
import { completeMerger, planMerger } from './actions';

export const dynamic = 'force-dynamic';

/** Fusion av helägt dotterbolag: fusionsplan, registrering och bokföring i båda bolagen */
export default async function Merger({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const t = today();
  const rows = ctx.role === 'owner' ? await allowedCompanies(await overview(ctx.user.id, ctx.company.id, t)) : [];
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Fusion av dotterbolag</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett helägt dotterbolag kan gå upp i moderbolaget genom en förenklad fusion: styrelserna upprättar en fusionsplan som registreras hos Bolagsverket, Bolagsverket kallar på dotterbolagets
        borgenärer och ger tillstånd, och när fusionen registreras är dotterbolaget upplöst. Moderbolaget tar över tillgångar, skulder och obeskattade reserver till bokförda värden (andelsvärdemetoden).
        Fusionen är skattefri; en fusionsförlust är inte avdragsgill.</p>
      {!rows.length && <EmptyState icon="briefcase" title="Inga helägda dotterbolag">Lägg upp dotterbolaget med 100 % ägarandel under Koncern – du ska vara ägare i båda bolagen.</EmptyState>}
      {rows.map((r) => (
        <section key={r.id} className="card stack merger" data-name={r.name}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}><Link href={`/c/${r.id}`}>{r.name}</Link></h2>
          {r.merger?.registered_on
            ? <p className="merger-done" style={{ margin: 0 }}>Fusionen registrerades {r.merger.registered_on}. Nettotillgångar {kr(r.merger.net_assets ?? 0)} kr mot aktiernas bokförda värde {kr(r.merger.share_value ?? 0)} kr – fusionsdifferens {kr(r.merger.difference ?? 0)} kr ({r.merger.treatment === 'goodwill' ? 'goodwill' : 'eget kapital'}).
                Dotterbolagets sista räkenskapsår slutar på registreringsdagen.</p>
            : <>
              {r.acquisition_cost == null && <p className="small mg-missing" style={{ margin: 0 }}>⚠️ Ange aktiernas anskaffningsvärde för dotterbolaget under <Link href={`/koncern`}>Koncern</Link> först.</p>}
              {r.preview && <table className="small"><tbody>
                <tr><td>Dotterbolagets tillgångar minus skulder och obeskattade reserver per {t}</td><td className="num mg-net">{kr(r.preview.net)}</td></tr>
                <tr><td>Aktiernas bokförda värde i moderbolaget</td><td className="num">{kr(r.preview.shareValue)}</td></tr>
                <tr><td><b>Fusionsdifferens</b></td><td className="num mg-diff"><b>{kr(r.preview.difference)}</b></td></tr></tbody></table>}
              {!r.merger ? <form action={planMerger.bind(null, ctx.company.id, r.id)} className="row"><label>Fusionsplan undertecknad<input type="date" name="plan_date" defaultValue={t} required /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Registrera fusionsplan</button></div></form>
                : <form action={completeMerger.bind(null, ctx.company.id, r.id)} className="row">
                  <span className="small">Fusionsplan {r.merger.plan_date}.</span>
                  <label>Bolagsverket registrerade fusionen<input type="date" name="registered_on" defaultValue={t} required /></label>
                  <label>Aktierna bokförda på konto<input name="shares_account" defaultValue="1311" style={{ width: '5rem' }} /></label>
                  <label>Negativ fusionsdifferens<select name="treatment"><option value="equity">Mot eget kapital</option><option value="goodwill">Som goodwill (övervärde)</option></select></label>
                  <div style={{ flex: '0 0 auto' }}><button>Bokför fusionen i båda bolagen</button></div>
                </form>}
            </>}
        </section>
      ))}
    </div>
  );
}
