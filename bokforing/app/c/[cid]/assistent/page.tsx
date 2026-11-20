import { requireCompany } from '@/lib/server/auth';
import { Assistant } from '@/components/Assistant';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';
import { askAssistant, runSuggestion } from './actions';

export const dynamic = 'force-dynamic';

export default async function AssistantPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, aiAccess } = await requireCompany(cid);
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Fråga assistenten</h1>
      <p className="muted">Ställ frågor om bolagets siffror – resultat, kassa, kunder, kostnader och moms – eller om bokföring i allmänhet. Assistenten läser bokföringen och kan föreslå åtgärder – till exempel påminnelser eller bankavstämning – som du godkänner med ett klick. Kontrollera viktiga siffror i rapporterna.</p>
      {invoiceAiEnabled() && !aiAccess ? <p className="card no-ai-access">Assistenten är bara påslagen för de användare som bolagets ägare har gett tillgång. Be ägaren slå på det för dig under Inställningar.</p>
        : invoiceAiEnabled() ? <Assistant ask={askAssistant.bind(null, company.id)} run={runSuggestion.bind(null, company.id)} base={`/c/${company.id}`} /> : <p>Assistenten är inte påslagen (kräver ANTHROPIC_API_KEY).</p>}
    </div>
  );
}
