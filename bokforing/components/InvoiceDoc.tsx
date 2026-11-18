import type { InvoiceLineInput } from '@/lib/invoice';
import { computeInvoice, lineNet } from '@/lib/invoice';
import { kr } from '@/lib/format';
import { fmtHours, monthName } from '@/lib/time';
import type { Company } from '@/lib/server/auth';
import QRCode from 'qrcode';
import { formatSwish, swishQrData } from '@/lib/pain001';
import { formatPnr, labourInclVat, REDUCTION, type ReductionType } from '@/lib/rotrut';
import { DOC, langOf } from '@/lib/i18n';

export interface InvoiceDocData {
  invoice_number: number | null; invoice_date: string; due_date: string; delivery_date: string; ocr: string | null;
  our_reference: string; your_reference: string; notes: string; reverse_charge: boolean;
  hour_bank: { period: string; purchased: number; drawn_before: number; used_now: number; drawn: number; overage: number; remaining: number } | null;
  c_name: string; c_orgnr: string; c_vat: string; c_address: string; c_postal: string; c_city: string; c_country: string;
  currency?: string; exchange_rate?: number | string; language?: string;
  reduction_type?: ReductionType | null; tax_reduction?: number; buyer_pnr?: string; property?: string; brf_orgnr?: string; apartment_no?: string; work_type?: string;
}

/** Fakturans dokument (används i appen, i utskrift och på kundens länk) */
export async function InvoiceDoc({ inv, lines, co, orig, isCredit, time }: {
  inv: InvoiceDocData; lines: InvoiceLineInput[]; co: Company; orig?: { invoice_number: number } | null; isCredit: boolean;
  time: { id: number; date: string; activity_name: string; description: string; user_name: string; minutes: number }[];
}) {
  const cur = inv.currency ?? 'SEK';
  const foreign = cur !== 'SEK';
  const L = DOC[langOf(inv.language)];
  const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge, roundToKrona: !foreign });
  const hb = inv.hour_bank;
  const red = inv.reduction_type ? inv.tax_reduction ?? 0 : 0;
  const toPay = t.total - red;
  const labour = inv.reduction_type ? labourInclVat(lines, t, inv.reverse_charge) : 0;
  const swish = co.swish_number && !isCredit && toPay > 0 && !foreign
    ? { data: swishQrData(co.swish_number, toPay, inv.ocr ?? String(inv.invoice_number ?? '')), svg: '' } : null;
  if (swish) swish.svg = await QRCode.toString(swish.data, { type: 'svg', margin: 1, width: 120 });
  return (
        <div className="doc">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
            <div>
              <h2 style={{ marginTop: 0 }}>{co.name}</h2>
              <div className="small">{co.address}<br />{co.postal_code} {co.city}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ marginTop: 0 }}>{isCredit ? L.credit : L.invoice}</h2>
              <table className="small" style={{ width: 'auto', marginLeft: 'auto' }}>
                <tbody>
                  <tr><td>{L.number}</td><td>{inv.invoice_number ?? '–'}</td></tr>
                  <tr><td>{L.date}</td><td>{inv.invoice_date}</td></tr>
                  {!isCredit && <tr><td>{L.due}</td><td><b>{inv.due_date}</b></td></tr>}
                  <tr><td>{L.delivery}</td><td>{inv.delivery_date || inv.invoice_date}</td></tr>
                  {inv.ocr && !isCredit && <tr><td>{L.ocr}</td><td className="mono">{inv.ocr}</td></tr>}
                  {orig && <tr><td>{L.credits}</td><td>{orig.invoice_number}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1.5rem 0', gap: '2rem' }}>
            <div className="small">
              {inv.our_reference && <>{L.ourRef}: {inv.our_reference}<br /></>}
              {inv.your_reference && <>{L.yourRef}: {inv.your_reference}</>}
            </div>
            <div style={{ minWidth: 240 }}>
              <b>{inv.c_name}</b><br />{inv.c_address}<br />{inv.c_postal} {inv.c_city}{inv.c_country !== 'SE' ? `, ${inv.c_country}` : ''}
              {inv.c_orgnr && <><br /><span className="small">{L.orgnr} {inv.c_orgnr}</span></>}
              {inv.c_vat && <><br /><span className="small">{L.vatNo} {inv.c_vat}</span></>}
            </div>
          </div>
          <table>
            <thead><tr><th>{L.description}</th><th className="num">{L.qty}</th><th className="num">{L.price}</th><th className="num">{L.vat}</th><th className="num">{L.amount}</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td className="num">{String(l.quantity).replace('.', ',')} {l.unit}</td>
                  <td className="num">{kr(l.unitPrice)}</td>
                  <td className="num">{inv.reverse_charge ? '–' : `${l.vatRate} %`}</td>
                  <td className="num">{kr(lineNet(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table style={{ width: 'auto', marginLeft: 'auto', marginTop: '1rem' }}>
            <tbody>
              <tr><td>{L.net}</td><td className="num">{kr(t.net)}</td></tr>
              {Object.entries(t.vatByRate).filter(([r]) => r !== '0').map(([r, v]) => (
                <tr key={r}><td>{L.vatLine(r, kr(v.base))}</td><td className="num">{kr(v.vat)}</td></tr>
              ))}
              {t.rounding !== 0 && <tr><td>{L.rounding}</td><td className="num">{kr(t.rounding)}</td></tr>}
              {inv.reduction_type && <>
                <tr><td>{L.totalInclVat}</td><td className="num">{kr(t.total)}</td></tr>
                <tr><td>{REDUCTION[inv.reduction_type].label} ({REDUCTION[inv.reduction_type].pct} % av arbetskostnad {kr(labour)} kr inkl. moms)</td><td className="num">−{kr(red)}</td></tr>
              </>}
              <tr className="sum"><td>{isCredit ? L.toCredit : L.toPay} {cur}</td><td className="num">{kr(toPay)}</td></tr>
              {foreign && <tr className="small muted"><td colSpan={2}>{L.rate(cur, Number(inv.exchange_rate ?? 0).toLocaleString('sv-SE', { maximumFractionDigits: 6 }))}</td></tr>}
            </tbody>
          </table>
          {inv.reverse_charge && <p><b>{L.reverseCharge}</b> ({langOf(inv.language) === 'en' ? 'VAT' : 'Reverse charge'}, art. 196 Directive 2006/112/EC). {L.buyerVat}: {inv.c_vat}</p>}
          {inv.reduction_type && (
            <div className="small" style={{ border: '1px solid #ccc', borderRadius: 6, padding: '.6rem .9rem', margin: '1rem 0' }}>
              <b>{REDUCTION[inv.reduction_type].label}</b> – fakturan gäller {inv.work_type}. Arbetskostnad {kr(labour)} kr, material och övrigt {kr(t.total - labour)} kr (inkl. moms).
              {' '}Köpare: {inv.c_name}, personnummer {formatPnr(inv.buyer_pnr ?? '')}.
              {inv.reduction_type === 'rot' && (inv.property ? ` Fastighet: ${inv.property}.` : ` Bostadsrättsförening ${inv.brf_orgnr}, lägenhet ${inv.apartment_no}.`)}
              {' '}{co.name} har F-skatt och begär {kr(red)} kr från Skatteverket när du har betalat. Beviljas inte hela avdraget betalar du mellanskillnaden.
            </div>
          )}
          {inv.notes && <p>{inv.notes}</p>}
          {hb && (
            <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: '.75rem 1rem', margin: '1rem 0', maxWidth: 420 }}>
              <b>{L.hourBank} {monthName(hb.period)}</b>
              <table className="small" style={{ marginTop: '.4rem' }}>
                <tbody>
                  <tr><td>Köpta timmar totalt</td><td className="num">{fmtHours(hb.purchased)}</td></tr>
                  <tr><td>Använt tidigare</td><td className="num">{fmtHours(hb.drawn_before)}</td></tr>
                  <tr><td>Använt {monthName(hb.period)}</td><td className="num">{fmtHours(hb.used_now)}</td></tr>
                  {hb.overage > 0 && <tr><td>Varav utöver timbanken (faktureras)</td><td className="num">{fmtHours(hb.overage)}</td></tr>}
                  <tr className="sum"><td><b>Kvar i timbanken</b></td><td className="num"><b>{fmtHours(hb.remaining)}</b></td></tr>
                </tbody>
              </table>
            </div>
          )}
          {time.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <b>{L.timeSpec}</b>
              <table className="small" style={{ marginTop: '.4rem' }}>
                <thead><tr><th>Datum</th><th>Aktivitet</th><th>Beskrivning</th><th>Utförd av</th><th className="num">Tid</th></tr></thead>
                <tbody>
                  {time.map((e) => (
                    <tr key={e.id}><td>{e.date}</td><td>{e.activity_name}</td><td>{e.description}</td><td>{e.user_name}</td><td className="num">{fmtHours(e.minutes)}</td></tr>
                  ))}
                  <tr className="sum"><td colSpan={4}>Summa</td><td className="num">{fmtHours(time.reduce((s, e) => s + e.minutes, 0))}</td></tr>
                </tbody>
              </table>
            </div>
          )}
          <hr style={{ margin: '2rem 0 1rem', border: 0, borderTop: '1px solid #ddd' }} />
          <div className="small" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div>{co.name}<br />{co.address}<br />{co.postal_code} {co.city}</div>
            <div>{L.orgnr} {co.orgnr}<br />{co.vat_number && <>{L.vatNo} {co.vat_number}<br /></>}{co.f_skatt ? L.fSkatt : ''}</div>
            <div>{co.bankgiro && <>Bankgiro {co.bankgiro}<br /></>}{co.plusgiro && <>Plusgiro {co.plusgiro}<br /></>}{co.iban && <>IBAN {co.iban}</>}</div>
            <div>{co.email}<br />{co.phone}</div>
          </div>
          {swish && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem', border: '1px solid #ddd', borderRadius: 6, padding: '.6rem .8rem', maxWidth: 420 }}>
              <div style={{ width: 120, height: 120, flex: '0 0 auto' }} dangerouslySetInnerHTML={{ __html: swish.svg }} />
              <div className="small"><b>Betala med Swish</b><br />Swishnummer {formatSwish(co.swish_number)}<br />Belopp {kr(toPay)} kr<br />Meddelande {inv.ocr ?? inv.invoice_number}</div>
            </div>
          )}
          {!isCredit && <p className="small" style={{ marginTop: '1rem' }}>{L.lateInterest ?? co.late_interest}</p>}
        </div>
  );
}
