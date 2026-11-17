import { handleApi } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ path: string[] }> };
const h = async (req: Request, { params }: P) => handleApi(req, (await params).path);

export { h as GET, h as POST, h as PATCH, h as DELETE };
