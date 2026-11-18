import { handleShopWebhook } from '@/lib/services/shop';

export const dynamic = 'force-dynamic';

/** Webhook från Shopify (orders/paid) eller WooCommerce (order.updated) – adressen innehåller kopplingens hemliga token */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.text();
  try {
    const r = await handleShopWebhook(token, req.headers, body);
    return Response.json({ result: r.result }, { status: r.status });
  } catch (e) {
    console.error('shop webhook', e);
    return new Response('Fel', { status: 500 });
  }
}
