export type CustomerRow = {
  id: number; name: string; orgnr: string; vat_number: string; email: string; phone?: string; address: string; postal_code: string;
  city: string; country: string; payment_terms: number | null; reverse_charge: boolean; construction_rc: boolean; peppol_id: string; currency: string; language: string;
};

export function CustomerFields({ c }: { c?: Partial<CustomerRow> }) {
  return (
    <>
      <div className="row">
        <label style={{ flex: '2 1 260px' }}>Namn<input name="name" defaultValue={c?.name} required /></label>
        <label>Org.nr / personnr<input name="orgnr" defaultValue={c?.orgnr} /></label>
        <label>E-post<input name="email" type="email" defaultValue={c?.email} /></label>
        <label>Mobil (för SMS-påminnelser)<input name="phone" type="tel" defaultValue={c?.phone} /></label>
      </div>
      <div className="row">
        <label style={{ flex: '2 1 260px' }}>Adress<input name="address" defaultValue={c?.address} /></label>
        <label>Postnummer<input name="postal_code" defaultValue={c?.postal_code} /></label>
        <label>Ort<input name="city" defaultValue={c?.city} /></label>
        <label style={{ flex: '0 0 90px' }}>Land<input name="country" defaultValue={c?.country ?? 'SE'} maxLength={2} /></label>
      </div>
      <div className="row">
        <label>Betalningsvillkor (dagar, tomt = standard)<input name="payment_terms" type="number" min={0} defaultValue={c?.payment_terms ?? ''} /></label>
        <label>Momsreg.nr (EU-kund)<input name="vat_number" defaultValue={c?.vat_number} /></label>
        <label className="check"><input type="checkbox" name="reverse_charge" defaultChecked={c?.reverse_charge} /> Omvänd skattskyldighet (tjänster till EU-företag)</label>
        <label className="check"><input type="checkbox" name="construction_rc" defaultChecked={c?.construction_rc} /> Omvänd byggmoms (byggtjänster till byggföretag)</label>
      </div>
      <div className="row">
        <label>Valuta på fakturor<select name="currency" defaultValue={c?.currency ?? 'SEK'}>{['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK'].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Språk på fakturor<select name="language" defaultValue={c?.language ?? 'sv'}><option value="sv">Svenska</option><option value="en">Engelska</option></select></label>
      </div>
      <div className="row">
        <label>Peppol-ID för e-faktura<input name="peppol_id" defaultValue={c?.peppol_id} placeholder="0007:5560269986" /></label>
        <span className="small muted" style={{ alignSelf: 'end', flex: '3 1 300px' }}>Krävs för e-faktura till offentlig sektor och många större företag. Svenska organisationer har oftast 0007 följt av organisationsnumret. Slå upp mottagaren i Peppol Directory.</span>
      </div>
    </>
  );
}
