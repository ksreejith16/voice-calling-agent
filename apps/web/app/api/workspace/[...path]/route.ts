import { auth } from '@clerk/nextjs/server';
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ message: 'Sign in to continue' }, { status: 401 });
  const { path } = await context.params;
  const route = path.join('/');
  if (!/^(agents\/[0-9a-f-]{36}|voice-tests\/(agent\/)?[0-9a-f-]{36})$/i.test(route)) return Response.json({ message: 'Not found' }, { status: 404 });
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ message: 'Invalid origin' }, { status: 403 });
  try {
    const token = await getToken();
    const response = await fetch(`${API}/${route}`, { method: request.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(['POST','PATCH'].includes(request.method) ? { body: await request.text() } : {}), cache: 'no-store', signal: AbortSignal.timeout(25000) });
    return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ message: 'API is unavailable. Check the API server and try again.' }, { status: 503 }); }
}
export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
