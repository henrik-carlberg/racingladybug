import { CORE_SCOPES } from './routes';
import { MODULES } from '@/modules/registry';

export function allScopes(): { scope: string; description: string; module?: string }[] {
  return [...CORE_SCOPES, ...MODULES.flatMap((m) => (m.scopes ?? []).map((s) => ({ ...s, module: m.name })))];
}
