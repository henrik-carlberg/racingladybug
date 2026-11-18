import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { acceptInvite } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function FirmInvite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const user = await requireUser();
  return (
    <div className="center">
      <h1>Inbjudan till byrå</h1>
      <Flash searchParams={searchParams} />
      <form action={acceptInvite.bind(null, token)} className="card stack">
        <p style={{ margin: 0 }}>Du är inloggad som {user.email}. Gå med i byrån för att se byråns klienter.</p>
        <div><button>Gå med i byrån</button></div>
      </form>
    </div>
  );
}
