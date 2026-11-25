// Behörigheter per användare och bolag – ren logik (testbar)
export const PERMISSIONS = {
  invoicing: 'Kundfakturor, offerter och kunder',
  purchasing: 'Registrera leverantörsfakturor',
  attest: 'Attestera leverantörsfakturor',
  payments: 'Betala (leverantörsbetalningar och betalfiler)',
  payroll: 'Lön, anställda och frånvaro',
  ledger: 'Verifikationer, bank, moms och bokslut',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Ägaren har alltid alla behörigheter. Övriga roller har alla om inget är begränsat (null). */
export function hasPermission(role: string, perms: string[] | null | undefined, p: Permission): boolean {
  if (role === 'owner') return true;
  if (role === 'employee') return false;
  if (role === 'auditor') return false; // revisorn läser men ändrar inte; sidor öppnas via läsbehörighet
  return perms == null || perms.includes(p);
}

/** Läsbehörighet till en del av appen (revisorn får läsa allt) */
export function canView(role: string, perms: string[] | null | undefined, p: Permission): boolean {
  if (role === 'auditor') return true;
  return hasPermission(role, perms, p);
}

export function parsePermissions(v: unknown): Permission[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  return ALL_PERMISSIONS.filter((p) => arr.includes(p));
}

/** Dokument från styrelsearbetet innehåller bokföringsuppgifter och visas bara för den med läsbehörighet till bokföringen (eller som ska signera) */
export const LEDGER_DOCUMENT_SOURCES = ['styrelsepaket', 'styrelsemoten', 'aktiebok'];
export const canSeeDocument = (role: string, perms: string[] | null | undefined, sourceModule: string | null, isSigner: boolean) =>
  isSigner || !sourceModule || !LEDGER_DOCUMENT_SOURCES.includes(sourceModule) || canView(role, perms, 'ledger');
