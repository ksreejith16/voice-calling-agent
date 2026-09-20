import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

async function forward(req: NextRequest, method: string, body?: unknown) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(`${API_URL}/agents`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function GET(req: NextRequest) { return forward(req, "GET"); }
export async function POST(req: NextRequest) { return forward(req, "POST", await req.json()); }
