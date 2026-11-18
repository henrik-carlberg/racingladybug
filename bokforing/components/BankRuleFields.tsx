import type { RuleOut } from '@/lib/services/bank-rules';

const dec = (ore: number | null | undefined) => (ore == null ? '' : (ore / 100).toFixed(2).replace('.', ','));

export function BankRuleFields({ r, prefill }: { r?: RuleOut; prefill?: { pattern?: string; account?: string; vat?: string; direction?: string; description?: string } }) {
  return (
    <>
      <div className="row">
        <label style={{ flex: '2 1 200px' }}>Sökord (alla ord ska finnas i motpart, text eller referens; * matchar början av ord)<input name="pattern" defaultValue={r?.pattern ?? prefill?.pattern} required placeholder="telia" /></label>
        <label>Namn<input name="name" defaultValue={r?.name} placeholder="Telia" /></label>
        <label style={{ flex: '0 0 140px' }}>Riktning<select name="direction" defaultValue={r?.direction ?? prefill?.direction ?? 'any'}><option value="any">In och ut</option><option value="out">Uttag</option><option value="in">Insättning</option></select></label>
      </div>
      <div className="row">
        <label style={{ flex: '0 0 120px' }}>Konto<input name="account" list="chart" defaultValue={r?.account ?? prefill?.account} required /></label>
        <label style={{ flex: '0 0 110px' }}>Moms<select name="vat_rate" defaultValue={String(r?.vatRate ?? prefill?.vat ?? 0)}><option value="0">Ingen</option><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option></select></label>
        <label>Text på verifikationen<input name="description" defaultValue={r?.description ?? prefill?.description} /></label>
        <label style={{ flex: '0 0 120px' }}>Från belopp<input name="amount_min" inputMode="decimal" defaultValue={dec(r?.amountMin)} /></label>
        <label style={{ flex: '0 0 120px' }}>Till belopp<input name="amount_max" inputMode="decimal" defaultValue={dec(r?.amountMax)} /></label>
      </div>
      <label className="check"><input type="checkbox" name="auto" defaultChecked={r?.auto} /> Bokför automatiskt (utan granskning) när transaktionen kommer från banken</label>
    </>
  );
}
