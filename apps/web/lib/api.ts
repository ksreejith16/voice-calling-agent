import "server-only";
import { auth } from "@clerk/nextjs/server";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

async function apiToken(): Promise<string | null> {
  const { getToken } = await auth();
  return getToken();
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await apiToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getMe() {
  return apiFetch<{
    provisioned: boolean;
    userId?: string;
    role?: string;
    organization?: { id: string; name: string; slug: string; status: string; defaults: Record<string, string> };
    wallet?: { id: string; balancePaise: string; reservedPaise: string; availablePaise: string } | null;
  }>("/auth/me");
}

export async function getOverview() {
  return apiFetch<{
    wallet: { availableRupees: number; balancePaise: string; reservedPaise: string; availablePaise: string };
    campaigns: { running: number; draft: number; paused: number; total: number };
    leads: { new: number; qualified: number; total: number };
    calls: { connected: number; completed: number; failed: number; total: number };
    providerStatus: Record<string, string>;
  }>("/dashboard/overview");
}

export async function getAgents() {
  return apiFetch<Array<{
    id: string; name: string; description: string; language: string;
    voice: string | null; instructions: string; openingMessage: string; createdAt: string;
  }>>("/agents");
}

export async function getCampaigns() {
  return apiFetch<Array<{
    id: string; name: string; status: string; language: string;
    ratePaisePerMinute: string; createdAt: string;
  }>>("/campaigns");
}

export async function getCampaign(id: string) {
  return apiFetch<{
    id: string; name: string; status: string; goal: string; persona: string;
    language: string; voice: string | null; ratePaisePerMinute: string;
    billingQuantumSeconds: number; maxConnectedDurationSeconds: number;
    concurrencyLimit: number; pauseReason: string | null;
    scheduledAt: string | null; createdAt: string; updatedAt: string;
  }>(`/campaigns/${id}`);
}

export async function getLeads(params?: { campaignId?: string; status?: string }) {
  const qs = new URLSearchParams(params as Record<string, string> ?? {}).toString();
  return apiFetch<Array<{
    id: string; campaignId: string; phoneE164: string; name: string | null;
    status: string; qualification: string | null; qualificationScore: number | null;
    attemptCount: number; lastAttemptAt: string | null; createdAt: string;
  }>>(`/leads${qs ? `?${qs}` : ""}`);
}

export async function getLead(id: string) {
  return apiFetch<{
    id: string; campaignId: string; phoneE164: string; name: string | null;
    source: string; externalReference: string | null;
    status: string; qualification: string | null; qualificationScore: number | null;
    attemptCount: number; nextAttemptAt: string | null; lastAttemptAt: string | null;
    lastOutcome: string | null; consentEvidence: Record<string, unknown>;
    attributes: Record<string, unknown>; createdAt: string; updatedAt: string;
  }>(`/leads/${id}`);
}

export async function getCalls(params?: { campaignId?: string; leadId?: string }) {
  const qs = new URLSearchParams(params as Record<string, string> ?? {}).toString();
  return apiFetch<Array<{
    id: string; campaignId: string; leadId: string; status: string;
    attemptNumber: number; connectedDurationSeconds: number | null;
    chargedPaise: string; settlementStatus: string;
    queuedAt: string | null; connectedAt: string | null; endedAt: string | null;
    errorCode: string | null;
  }>>(`/calls${qs ? `?${qs}` : ""}`);
}

export async function getCall(id: string) {
  return apiFetch<{
    id: string; campaignId: string; leadId: string; walletId: string;
    attemptNumber: number; provider: string | null; providerCallId: string | null;
    status: string; queuedAt: string; startedAt: string | null;
    connectedAt: string | null; endedAt: string | null;
    connectedDurationSeconds: number | null; billableSeconds: number;
    ratePaisePerMinute: string; billingQuantumSeconds: number;
    maxConnectedDurationSeconds: number; chargedPaise: string;
    settlementStatus: string; settledAt: string | null;
    errorCode: string | null; recordingConsentGranted: boolean;
    createdAt: string; updatedAt: string;
  }>(`/calls/${id}`);
}

export async function getWallet() {
  return apiFetch<{
    id: string; balancePaise: string; reservedPaise: string;
    availablePaise: string; availableRupees: number;
  }>("/wallet");
}

export async function getTransactions() {
  return apiFetch<Array<{
    id: string; reason: string; direction: string; amountPaise: string;
    balanceAfterPaise: string; description: string; createdAt: string;
  }>>("/wallet/transactions");
}

export async function getIntegrations() {
  return apiFetch<Record<string, { status: string; label: string; note: string }>>("/dashboard/integrations");
}
