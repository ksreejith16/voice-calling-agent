import { auth } from "@clerk/nextjs/server";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
const ALLOWED_ACTIONS = new Set(["launch", "pause"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ message: "Sign in to continue" }, { status: 401 });

  const { id, action } = await context.params;
  if (!ALLOWED_ACTIONS.has(action)) return Response.json({ message: "Not found" }, { status: 404 });

  const token = await getToken();
  try {
    const resp = await fetch(`${API}/campaigns/${id}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.text();
    return new Response(data, { status: resp.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ message: "API is unavailable" }, { status: 503 });
  }
}
