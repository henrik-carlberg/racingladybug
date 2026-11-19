// Menyns struktur: få, tydliga sektioner med vardagliga namn. Används av sidomenyn och sökningen (Ctrl+K).
import type { Permission } from './permissions';

export interface NavItem { href: string; label: string; hint?: string }
export interface NavSection { id: string; label: string; icon: string; items: NavItem[] }

type Raw = { path: string; label: string; perm?: Permission; hint?: string };

export function buildNav(o: {
  base: string; see: (p: Permission) => boolean; t: (s: string) => string;
  modules: { id: string; name: string; nav?: { label: string; path: string }[] }[];
}): { top: NavItem[]; sections: NavSection[] } {
  const { base: b, see, t } = o;
  const items = (list: Raw[]) => list.filter((x) => !x.perm || see(x.perm)).map((x) => ({ href: `${b}${x.path}`, label: t(x.label), hint: x.hint ? t(x.hint) : undefined }));
  const top = items([
    { path: '', label: 'Översikt', hint: 'Vad som väntar och de vanligaste uppgifterna' },
    { path: '/kvitto', label: 'Nytt kvitto', hint: 'Fota ett kvitto så bokförs det' },
    { path: '/assistent', label: 'Fråga assistenten', hint: 'Fråga om bolagets siffror' },
  ]);
  const sections: NavSection[] = [
    { id: 'salj', label: t('Sälja'), icon: 'invoice', items: items([
      { path: '/fakturor', label: 'Kundfakturor', perm: 'invoicing', hint: 'Skapa, skicka och följ upp fakturor' },
      { path: '/kunder', label: 'Kunder', perm: 'invoicing' },
      { path: '/kassa', label: 'Kassa och e-handel', hint: 'Dagskassa och webbutik' },
      { path: '/kassa/betalningar', label: 'Kortterminaler och utbetalningar', perm: 'ledger', hint: 'Zettle, SumUp, Stripe, Klarna, Shopify' },
      { path: '/fakturor/rotrut', label: 'ROT och RUT', perm: 'invoicing' },
      { path: '/peppol', label: 'E-faktura (Peppol)', perm: 'invoicing', hint: 'Skickade och mottagna e-fakturor' },
      { path: '/autogiro', label: 'Autogiro', perm: 'invoicing', hint: 'Dra betalningen från kundens konto' },
      { path: '/tid', label: '⏱ Tidrapportering' },
      { path: '/uppdrag', label: 'Uppdrag & timbanker' },
      { path: '/tid/belaggning', label: 'Beläggning' },
    ]) },
    { id: 'kop', label: t('Köpa och betala'), icon: 'inbox', items: items([
      { path: '/leverantorsfakturor/inkorg', label: 'Inkorg för fakturor', perm: 'purchasing', hint: 'Fakturor som kommit in via e-post och Peppol' },
      { path: '/leverantorsfakturor', label: 'Leverantörsfakturor', perm: 'purchasing' },
      { path: '/leverantorsfakturor/betalning', label: 'Betalningar', perm: 'payments', hint: 'Betala attesterade fakturor' },
      { path: '/leverantorer', label: 'Leverantörer' },
    ]) },
    { id: 'bank', label: t('Bank'), icon: 'bank', items: items([
      { path: '/bank/avstamning', label: 'Bankavstämning', perm: 'ledger', hint: 'Bokför transaktionerna från banken' },
      { path: '/bank', label: 'Bankkonton', perm: 'ledger' },
      { path: '/bank/regler', label: 'Konteringsregler', perm: 'ledger' },
      { path: '/skattekonto', label: 'Skattekontot', perm: 'ledger' },
    ]) },
    { id: 'lon', label: t('Lön och personal'), icon: 'users', items: items([
      { path: '/lon', label: 'Lönekörningar', perm: 'payroll', hint: 'Betala ut lön och skapa AGI' },
      { path: '/lon/anstallda', label: 'Anställda', perm: 'payroll' },
      { path: '/lon/franvaro', label: 'Frånvaro och semester', perm: 'payroll' },
      { path: '/schema', label: 'Schema' },
      { path: '/personalliggare', label: 'Personalliggare' },
      { path: '/lon/skattetabeller', label: 'Skattetabeller', perm: 'payroll' },
      { path: '/lon/bilforman', label: 'Bilförmån', perm: 'payroll' },
      { path: '/lon/avtal', label: 'Kollektivavtal', perm: 'payroll', hint: 'OB, övertid, beredskap, pension' },
      { path: '/agare', label: 'Ägare och utdelning', perm: 'ledger', hint: 'K10, gränsbelopp och lön eller utdelning' },
    ]) },
    { id: 'rapp', label: t('Rapporter'), icon: 'chart', items: items([
      { path: '/rapporter/panel', label: 'Instrumentpanel', hint: 'Diagram och nyckeltal' },
      { path: '/rapporter/manad', label: 'Månadsrapport' },
      { path: '/nyckeltal', label: 'Nyckeltal', perm: 'ledger', hint: 'För vd, ekonomi och styrelse' },
      { path: '/rapporter/egna', label: 'Egna rapporter', perm: 'ledger', hint: 'Bygg och dela egna rapporter' },
      { path: '/rapporter', label: 'Resultat & balans' },
      { path: '/rapporter/budget', label: 'Budget' },
      { path: '/rapporter/moms', label: 'Moms', hint: 'Momsdeklarationen' },
      { path: '/rapporter/eu', label: 'EU-handel' },
      { path: '/rapporter/huvudbok', label: 'Huvudbok' },
      { path: '/rapporter/dimensioner', label: 'Resultat per dimension' },
      { path: '/rapporter/export', label: 'Export (SIE)' },
      { path: '/rapporter/utskick', label: 'Schemalagda rapporter', perm: 'ledger', hint: 'Resultat och balans som Excel varje månad' },
    ]) },
    { id: 'bok', label: t('Bokföring'), icon: 'ledger', items: items([
      { path: '/verifikationer', label: 'Verifikationer', perm: 'ledger' },
      { path: '/verifikationer/ny', label: 'Ny verifikation', perm: 'ledger' },
      { path: '/bokslut', label: 'Bokslut & deklaration', perm: 'ledger' },
      { path: '/revision', label: 'Revision', perm: 'ledger', hint: 'Revisorns stickprov och anmärkningar' },
      { path: '/anlaggningar', label: 'Anläggningsregister' },
      { path: '/periodiseringar', label: 'Periodiseringar' },
      { path: '/konton', label: 'Kontoplan' },
      { path: '/arshjul', label: 'Årshjul', hint: 'Allt som återkommer under året, per modul' },
      { path: '/deadlines', label: 'Deadlines', hint: 'Moms, AGI och deklarationer' },
      { path: '/inlamning', label: 'Inlämning', hint: 'Skatteverket och Bolagsverket' },
      { path: '/fragor', label: 'Frågor och svar', hint: 'Frågor och underlag mellan dig och byrån' },
      { path: '/kommentarer', label: 'Kommentarer', hint: 'Kommentarer och @nämn' },
      { path: '/kom-igang', label: 'Kom igång' },
      { path: '/kom-igang/flytt', label: 'Flytta från annat program', perm: 'ledger', hint: 'Fortnox, Visma, Bokio – SIE och CSV' },
    ]) },
    // Tilläggsmoduler samlas i en sektion; modulens namn står först när den har flera sidor
    { id: 'moduler', label: t('Tillägg'), icon: 'puzzle', items: o.modules.flatMap((m) => {
      const nav = m.nav ?? [{ label: m.name, path: '' }];
      return nav.map((n) => ({ href: `${b}/m/${m.id}${n.path ? '/' + n.path : ''}`, label: nav.length > 1 && n.label !== m.name ? `${t(m.name)}: ${t(n.label)}` : t(m.name) }));
    }) },
    { id: 'inst', label: t('Inställningar'), icon: 'settings', items: items([
      { path: '/installningar', label: 'Inställningar', hint: 'Företagsuppgifter, räkenskapsår och användare' },
      { path: '/installningar/status', label: 'Kopplingar och status', hint: 'Bank, e-post, BankID och notiser – vad som saknas' },
      { path: '/moduler', label: 'Moduler', hint: 'Slå på CRM, lager, projekt m.m.' },
      { path: '/abonnemang', label: 'Abonnemang' },
      { path: '/installningar/betalningar', label: 'Kortbetalning' },
      { path: '/installningar/kostnadsstallen', label: 'Kostnadsställen' },
      { path: '/installningar/mallar', label: 'E-postmallar', perm: 'invoicing', hint: 'Texter för faktura, påminnelse och tack' },
      { path: '/installningar/byra', label: 'Redovisningsbyrå' },
      { path: '/dokument', label: 'Dokument & e-signering' },
      { path: '/integrationer', label: 'Integrationer (API)' },
      { path: '/installningar/gdpr', label: 'Dataskydd (GDPR)' },
      { path: '/historik', label: 'Behandlingshistorik' },
      { path: '/installningar/systemdokumentation', label: 'Systemdokumentation och arkiv', perm: 'ledger', hint: 'Bokföringslagen: dokumentation och arkivpaket per år' },
      { path: '/installningar/integritet', label: 'Integritetskontroll', perm: 'ledger', hint: 'Nattlig kontroll av balans, nummerserier och låsta perioder' },
    ]) },
  ].filter((s) => s.items.length);
  return { top, sections };
}

/** Snabbval för "Skapa" */
export function createActions(b: string, see: (p: Permission) => boolean, t: (s: string) => string): NavItem[] {
  return ([
    see('invoicing') && { href: `${b}/fakturor/ny`, label: t('Ny kundfaktura'), hint: t('Fakturera en kund') },
    { href: `${b}/kvitto`, label: t('Nytt kvitto'), hint: t('Fota ett kvitto') },
    see('purchasing') && { href: `${b}/leverantorsfakturor/ny`, label: t('Leverantörsfaktura'), hint: t('Registrera en faktura att betala') },
    see('invoicing') && { href: `${b}/kunder`, label: t('Ny kund'), hint: t('Lägg upp en kund') },
    see('ledger') && { href: `${b}/verifikationer/ny`, label: t('Ny verifikation'), hint: t('Bokför något manuellt') },
    see('payroll') && { href: `${b}/lon`, label: t('Lönekörning'), hint: t('Betala ut lön') },
  ].filter(Boolean)) as NavItem[];
}
