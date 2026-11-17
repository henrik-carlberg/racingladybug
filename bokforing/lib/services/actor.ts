import type { Role } from '@/lib/server/auth';

/** Den som utför en ändring: en inloggad användare eller en API-nyckel. */
export interface Actor {
  companyId: number;
  userId: number; // för API-nycklar: användaren som skapade nyckeln
  apiKeyId: number | null;
  role: Role | 'api';
}

export const userActor = (ctx: { company: { id: number }; user: { id: number }; role: Role }): Actor => ({
  companyId: ctx.company.id, userId: ctx.user.id, apiKeyId: null, role: ctx.role,
});
