export type EmployeeRow = {
  id: number; first_name: string; last_name: string; personal_number: string; email: string; address: string; postal_code: string; city: string;
  bank_clearing: string; bank_account: string; employment_start: string | null; employment_end: string | null; monthly_salary: number;
  tax_mode: 'table' | 'percent'; tax_table: number | null; tax_column: number; tax_percent: string | null; fee_override: string | null; active: boolean; vacation_days: number; hours_per_week: number;
  car_benefit: number; pension_percent: number; vacation_rule: string; employment_form: string; title: string;
};

export function EmployeeFields({ e }: { e?: Partial<EmployeeRow> }) {
  return (
    <>
      <div className="row">
        <label>Förnamn<input name="first_name" defaultValue={e?.first_name} required /></label>
        <label>Efternamn<input name="last_name" defaultValue={e?.last_name} required /></label>
        <label>Personnummer<input name="personal_number" defaultValue={e?.personal_number} required placeholder="ÅÅÅÅMMDD-NNNN" /></label>
        <label>E-post<input name="email" type="email" defaultValue={e?.email} /></label>
      </div>
      <div className="row">
        <label style={{ flex: '2 1 260px' }}>Adress<input name="address" defaultValue={e?.address} /></label>
        <label>Postnummer<input name="postal_code" defaultValue={e?.postal_code} /></label>
        <label>Ort<input name="city" defaultValue={e?.city} /></label>
      </div>
      <div className="row">
        <label>Clearingnr<input name="bank_clearing" defaultValue={e?.bank_clearing} /></label>
        <label>Kontonummer<input name="bank_account" defaultValue={e?.bank_account} /></label>
        <label>Anställd från<input type="date" name="employment_start" defaultValue={e?.employment_start ?? ''} /></label>
        <label>Anställd till<input type="date" name="employment_end" defaultValue={e?.employment_end ?? ''} /></label>
      </div>
      <div className="row">
        <label>Månadslön (kr)<input name="monthly_salary" defaultValue={e?.monthly_salary != null ? (e.monthly_salary / 100).toFixed(2).replace('.', ',') : ''} inputMode="decimal" /></label>
        <label>Skatteavdrag
          <select name="tax_mode" defaultValue={e?.tax_mode ?? 'table'}>
            <option value="table">Enligt skattetabell</option><option value="percent">Fast procentsats (sidoinkomst/jämkning)</option>
          </select>
        </label>
        <label>Skattetabell<input name="tax_table" type="number" min={29} max={42} defaultValue={e?.tax_table ?? ''} placeholder="t.ex. 32" /></label>
        <label>Kolumn<select name="tax_column" defaultValue={e?.tax_column ?? 1}>
          <option value="1">1 – vanligast för lön</option>
          {[2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k}</option>)}
        </select></label>
        <label>Procent (vid fast sats)<input name="tax_percent" defaultValue={e?.tax_percent ?? ''} placeholder="30" /></label>
      </div>
      <div className="row">
        <label>Avvikande arbetsgivaravgift % (t.ex. växa-stöd, tomt = automatisk)<input name="fee_override" defaultValue={e?.fee_override ?? ''} /></label>
        <label>Semesterdagar per år<input name="vacation_days" type="number" min={0} max={60} defaultValue={e?.vacation_days ?? 25} /></label>
        <label>Arbetstid timmar/vecka<input name="hours_per_week" inputMode="decimal" defaultValue={e?.hours_per_week ?? 40} /></label>
        <label className="check"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Aktiv (tas med i lönekörningar)</label>
      </div>
      <div className="row">
        <label>Befattning<input name="title" defaultValue={e?.title ?? ''} /></label>
        <label>Anställningsform<select name="employment_form" defaultValue={e?.employment_form ?? 'tillsvidare'}><option value="tillsvidare">Tillsvidare</option><option value="provanstallning">Provanställning</option><option value="visstid">Visstid</option><option value="timanstalld">Timanställd</option></select></label>
        <label>Semesterlön<select name="vacation_rule" defaultValue={e?.vacation_rule ?? 'same'}><option value="same">Sammalöneregeln</option><option value="percent">Procentregeln (12 %)</option></select></label>
      </div>
      <div className="row">
        <label>Bilförmån kr/mån (se Lön → Bilförmån)<input name="car_benefit" inputMode="decimal" defaultValue={e?.car_benefit ? (Number(e.car_benefit) / 100).toFixed(2).replace('.', ',') : ''} /></label>
        <label>Tjänstepension % av lönen<input name="pension_percent" inputMode="decimal" defaultValue={e?.pension_percent ? String(e.pension_percent).replace('.', ',') : ''} placeholder="T.ex. 4,5" /></label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Skattetabell och kolumn framgår av den anställdes skattebesked (Skatteverket). Kolumn 1 gäller för de flesta löntagare. Saknas A-skattsedel/skattebesked ska 30 % dras.</p>
    </>
  );
}
