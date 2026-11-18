import { requireCompany } from '@/lib/server/auth';
import { Assistant } from '@/components/Assistant';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';
import { askAssistant } from './actions';

export const dynamic = 'force-dynamic';

export default async function AssistantPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Fråga assistenten</h1>
      <p className="muted">Ställ frågor om bolagets siffror – resultat, kassa, kunder, kostnader och moms – eller om bokföring i allmänhet. Assistenten läser bokföringen men ändrar ingenting. Kontrollera viktiga siffror i rapporterna.</p>
      {invoiceAiEnabled() ? <Assistant ask={askAssistant.bind(null, company.id)} /> : <p>Assistenten är inte påslagen (kräver ANTHROPIC_API_KEY).</p>}
    </div>
  );
}
