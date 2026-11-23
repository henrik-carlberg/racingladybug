// Remburser och bankgarantier. Belopp i öre.
export const KINDS: Record<string, string> = { lc_import: 'Importremburs', lc_export: 'Exportremburs', guarantee_given: 'Ställd garanti', guarantee_received: 'Mottagen garanti' };
export const BANK_FEES = 6570;
export const DEFAULT_DOCS: Record<string, string[]> = {
  lc_import: ['Handelsfaktura', 'Transportdokument (konossement/fraktsedel)', 'Packlista', 'Ursprungscertifikat', 'Försäkringsbevis'],
  lc_export: ['Handelsfaktura', 'Transportdokument (konossement/fraktsedel)', 'Packlista', 'Ursprungscertifikat'],
  guarantee_given: [], guarantee_received: [],
};
export const feeLines = (amount: number, bank = 1930) => [{ account: BANK_FEES, amount }, { account: bank, amount: -amount }];

/** Ställd garanti är en eventualförpliktelse; spärrade egna medel är en ställd säkerhet */
export const commitmentsFor = (kind: string, amountSek: number, blocked: number) => ({
  guarantee: kind === 'guarantee_given' ? amountSek : 0,
  pledge: blocked,
});

export const daysLeft = (expires: string, today: string) => Math.round((Date.parse(expires) - Date.parse(today)) / 864e5);
export const docsReady = (docs: { done: boolean }[]) => docs.every((d) => d.done);
