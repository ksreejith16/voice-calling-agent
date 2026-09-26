import { auth } from "@clerk/nextjs/server";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ message: "Sign in to continue" }, { status: 401 });
  const token = await getToken();
  const body = await request.text();
  try {
    const resp = await fetch(`${API}/wallet/topup/order`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.text();
    return new Response(data, { status: resp.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ message: "API is unavailable" }, { status: 503 });
  }
}
