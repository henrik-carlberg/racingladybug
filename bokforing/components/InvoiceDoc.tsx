import type { InvoiceLineInput } from '@/lib/invoice';
import { computeInvoice, lineNet } from '@/lib/invoice';
import { kr } from '@/lib/format';
import { fmtHours, monthName } from '@/lib/time';
import type { Company } from '@/lib/server/auth';

export interface InvoiceDocData {
  invoice_number: number | null; invoice_date: string; due_date: string; delivery_date: string; ocr: string | null;
  our_reference: string; your_reference: string; notes: string; reverse_charge: boolean;
  hour_bank: { period: string; purchased: number; drawn_before: number; used_now: number; drawn: number; overage: number; remaining: number } | null;
  c_name: string; c_orgnr: string; c_vat: string; c_address: string; c_postal: string; c_city: string; c_country: string;
}

/** Fakturans dokument (används i appen, i utskrift och på kundens länk) */
export function InvoiceDoc({ inv, lines, co, orig, isCredit, time }: {
  inv: InvoiceDocData; lines: InvoiceLineInput[]; co: Company; orig?: { invoice_number: number } | null; isCredit: boolean;
  time: { id: number; date: string; activity_name: string; description: string; user_name: string; minutes: number }[];
}) {
  const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
  const hb = inv.hour_bank;
  return (
        <div className="doc">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
            <div>
              <h2 style={{ marginTop: 0 }}>{co.name}</h2>
              <div className="small">{co.address}<br />{co.postal_code} {co.city}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ marginTop: 0 }}>{isCredit ? 'KREDITFAKTURA' : 'FAKTURA'}</h2>
              <table className="small" style={{ width: 'auto', marginLeft: 'auto' }}>
                <tbody>
                  <tr><td>Fakturanummer</td><td>{inv.invoice_number ?? '–'}</td></tr>
                  <tr><td>Fakturadatum</td><td>{inv.invoice_date}</td></tr>
                  {!isCredit && <tr><td>Förfallodatum</td><td><b>{inv.due_date}</b></td></tr>}
                  <tr><td>Leveransdatum</td><td>{inv.delivery_date || inv.invoice_date}</td></tr>
                  {inv.ocr && !isCredit && <tr><td>OCR</td><td className="mono">{inv.ocr}</td></tr>}
                  {orig && <tr><td>Krediterar faktura</td><td>{orig.invoice_number}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1.5rem 0', gap: '2rem' }}>
            <div className="small">
              {inv.our_reference && <>Vår referens: {inv.our_reference}<br /></>}
              {inv.your_reference && <>Er referens: {inv.your_reference}</>}
            </div>
            <div style={{ minWidth: 240 }}>
              <b>{inv.c_name}</b><br />{inv.c_address}<br />{inv.c_postal} {inv.c_city}{inv.c_country !== 'SE' ? `, ${inv.c_country}` : ''}
              {inv.c_orgnr && <><br /><span className="small">Org.nr {inv.c_orgnr}</span></>}
              {inv.c_vat && <><br /><span className="small">Momsreg.nr {inv.c_vat}</span></>}
            </div>
          </div>
          <table>
            <thead><tr><th>Beskrivning</th><th className="num">Antal</th><th className="num">À-pris</th><th className="num">Moms</th><th className="num">Belopp</th></tr></thead>
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
              <tr><td>Belopp exkl. moms</td><td className="num">{kr(t.net)}</td></tr>
              {Object.entries(t.vatByRate).filter(([r]) => r !== '0').map(([r, v]) => (
                <tr key={r}><td>Moms {r} % (underlag {kr(v.base)})</td><td className="num">{kr(v.vat)}</td></tr>
              ))}
              {t.rounding !== 0 && <tr><td>Öresavrundning</td><td className="num">{kr(t.rounding)}</td></tr>}
              <tr className="sum"><td>{isCredit ? 'Att kreditera' : 'Att betala'} SEK</td><td className="num">{kr(t.total)}</td></tr>
            </tbody>
          </table>
          {inv.reverse_charge && <p><b>Omvänd betalningsskyldighet</b> (Reverse charge, art. 196 Directive 2006/112/EC). Köparens momsreg.nr: {inv.c_vat}</p>}
          {inv.notes && <p>{inv.notes}</p>}
          {hb && (
            <div style={{ border: '1px solid #ccc', borderRadius: 6, padding: '.75rem 1rem', margin: '1rem 0', maxWidth: 420 }}>
              <b>Timbank – avräkning {monthName(hb.period)}</b>
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
              <b>Tidsspecifikation</b>
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
            <div>Org.nr {co.orgnr}<br />{co.vat_number && <>Momsreg.nr {co.vat_number}<br /></>}{co.f_skatt ? 'Godkänd för F-skatt' : ''}</div>
            <div>{co.bankgiro && <>Bankgiro {co.bankgiro}<br /></>}{co.plusgiro && <>Plusgiro {co.plusgiro}<br /></>}{co.iban && <>IBAN {co.iban}</>}</div>
            <div>{co.email}<br />{co.phone}</div>
          </div>
          {!isCredit && <p className="small" style={{ marginTop: '1rem' }}>{co.late_interest}</p>}
        </div>
  );
}
