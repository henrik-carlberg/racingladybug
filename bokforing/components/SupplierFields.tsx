export type SupplierRow = { id: number; name: string; orgnr: string; bankgiro: string; plusgiro: string; bank_account: string; default_account: number; email: string; cost_center_id?: number | null };
export function SupplierFields({ s, costCenters = [] }: { s?: Partial<SupplierRow>; costCenters?: { id: number; code: string; name: string }[] }) {
  return (
    <>
      <div className="row">
        <label style={{ flex: '2 1 260px' }}>Namn<input name="name" defaultValue={s?.name} required /></label>
        <label>Org.nr<input name="orgnr" defaultValue={s?.orgnr} /></label>
        <label>E-post<input name="email" type="email" defaultValue={s?.email} /></label>
      </div>
      <div className="row">
        <label>Bankgiro<input name="bankgiro" defaultValue={s?.bankgiro} /></label>
        <label>Plusgiro<input name="plusgiro" defaultValue={s?.plusgiro} /></label>
        <label>Bankkonto (clearing + konto)<input name="bank_account" defaultValue={s?.bank_account} /></label>
        <label>Standardkonto för kostnad<input name="default_account" inputMode="numeric" defaultValue={s?.default_account ?? 4010} /></label>
        {costCenters.length > 0 && <label>Kostnadsställe<select name="cost_center_id" defaultValue={s?.cost_center_id ?? ''}><option value="">–</option>{costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
      </div>
    </>
  );
}
