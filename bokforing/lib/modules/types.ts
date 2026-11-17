import type { ReactNode } from 'react';
import type { Tx } from '@/lib/db';
import type { ApiRoute } from '@/lib/api/router';
import type { EventType } from '@/lib/events-catalog';
import type { Actor } from '@/lib/services/actor';

export interface ModuleEvent {
  id: string; // publikt händelse-id (evt_…)
  type: string;
  companyId: number;
  data: unknown;
}

export interface ModulePageProps {
  companyId: number;
  actor: Actor;
  params: Record<string, string>;
  searchParams: Record<string, string | undefined>;
  basePath: string; // /c/<cid>/m/<modul-id>
}

/**
 * En tilläggsmodul (t.ex. CRM, ERP, projekt, lager). Registreras i modules/registry.ts
 * och aktiveras per bolag under Inställningar → Moduler.
 */
export interface ModuleDefinition {
  id: string; // a–z, 0–9, bindestreck. Används i URL:er, scopes och migreringsmapp.
  name: string;
  description: string;
  version: string;
  /** Anställda med självservice får öppna modulens sidor (modulen ansvarar för att begränsa till egen data) */
  employeeAccess?: boolean;
  /** Menyval under modulens rubrik i sidomenyn. path är relativ modulens bas-URL. */
  nav?: { label: string; path: string }[];
  /** Sidor: mönster ('', 'kontakter/:id') → serverkomponent */
  pages?: Record<string, (p: ModulePageProps) => Promise<ReactNode> | ReactNode>;
  /** API-endpoints, monteras under /api/v1/m/<modul-id>/… */
  api?: ApiRoute[];
  /** Behörigheter som modulens API använder, t.ex. 'crm:read' */
  scopes?: { scope: string; description: string }[];
  /** Händelser som modulen själv skickar (kan prenumereras på via webhooks) */
  events?: EventType[];
  /**
   * Lyssnare på händelser (kärnans eller andra modulers). Körs i samma databastransaktion
   * som ändringen, men bara för bolag där modulen är aktiverad. '*' = alla händelser.
   */
  on?: Record<string, (event: ModuleEvent, tx: Tx) => Promise<void>>;
}
