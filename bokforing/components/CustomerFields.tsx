export type CustomerRow = {
  id: number; name: string; orgnr: string; vat_number: string; email: string; address: string; postal_code: string;
  city: string; country: string; payment_terms: number | null; reverse_charge: boolean;
};

export function CustomerFields({ c }: { c?: Partial<CustomerRow> }) {
  return (
    <>
      <div className="row">
        <label style={{ flex: '2 1 260px' }}>Namn<input name="name" defaultValue={c?.name} required /></label>
        <label>Org.nr / personnr<input name="orgnr" defaultValue={c?.orgnr} /></label>
        <label>E-post<input name="email" type="email" defaultValue={c?.email} /></label>
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
      </div>
    </>
  );
}
