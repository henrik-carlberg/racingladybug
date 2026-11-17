import type { ModuleDefinition } from '@/lib/modules/types';
import { crm } from './crm';
import { hrModule } from './hr';
import { lonerevision } from './lonerevision';
import { lager } from './lager';
import { marknad } from './marknad';
import { projekt } from './projekt';
import { resurser } from './resurser';

/**
 * Alla tillgängliga tilläggsmoduler. För att lägga till en ny modul (t.ex. ERP, lager, projekt):
 *   1. Skapa modules/<id>/index.tsx som exporterar en ModuleDefinition
 *   2. Lägg eventuella tabeller i modules/<id>/migrations/*.sql (körs av npm run db:migrate)
 *   3. Lägg till modulen i listan nedan
 * Modulen aktiveras sedan per bolag under Inställningar → Moduler.
 */
export const MODULES: ModuleDefinition[] = [crm, hrModule, lonerevision, lager, marknad, projekt, resurser];

export const getModule = (id: string) => MODULES.find((m) => m.id === id);
