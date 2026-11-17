import type { ModuleDefinition } from '@/lib/modules/types';
import { crm } from './crm';
import { hrModule } from './hr';
import { lonerevision } from './lonerevision';

/**
 * Alla tillgängliga tilläggsmoduler. För att lägga till en ny modul (t.ex. ERP, lager, projekt):
 *   1. Skapa modules/<id>/index.tsx som exporterar en ModuleDefinition
 *   2. Lägg eventuella tabeller i modules/<id>/migrations/*.sql (körs av npm run db:migrate)
 *   3. Lägg till modulen i listan nedan
 * Modulen aktiveras sedan per bolag under Inställningar → Moduler.
 */
export const MODULES: ModuleDefinition[] = [crm, hrModule, lonerevision];

export const getModule = (id: string) => MODULES.find((m) => m.id === id);
