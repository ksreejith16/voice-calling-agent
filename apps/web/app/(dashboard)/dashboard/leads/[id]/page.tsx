"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Lead = {
  id: string; campaignId: string; phoneE164: string; name: string | null;
  source: string; externalReference: string | null;
  status: string; qualification: string | null; qualificationScore: number | null;
  attemptCount: number; nextAttemptAt: string | null; lastAttemptAt: string | null;
  lastOutcome: string | null; consentEvidence: Record<string, unknown>;
  attributes: Record<string, unknown>; createdAt: string; updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  new: "badge--gray", queued: "badge--blue", calling: "badge--yellow",
  contacted: "badge--purple", qualified: "badge--green", unqualified: "badge--red",
  do_not_call: "badge--red", exhausted: "badge--gray",
};

const QUAL_COLORS: Record<string, string> = {
  hot: "badge--green", warm: "badge--yellow", cold: "badge--blue",
};

async function fetchLead(id: string): Promise<Lead | null> {
  const res = await fetch(`/api/workspace/leads/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function patchLead(id: string, body: { status: string }) {
  const res = await fetch(`/api/workspace/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : "Update failed");
  return data;
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    params.then(({ id: resolvedId }) => {
      setId(resolvedId);
      fetchLead(resolvedId).then((l) => { setLead(l); setLoading(false); });
    });
  }, [params]);

  async function setStatus(status: string) {
    if (!id) return;
    if (!window.confirm(`Change lead status to "${status}"?`)) return;
    setBusy(true); setMessage("");
    try {
      await patchLead(id, { status });
      const updated = await fetchLead(id);
      setLead(updated);
      setMessage(`Lead status updated to ${status}.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="dash-page"><p>Loading…</p></div>;
  if (!lead) {
    return (
      <div className="dash-page">
        <div className="dash-page-header">
          <Link href="/dashboard/leads" className="dash-link">← Leads</Link>
        </div>
        <div className="dash-empty">
          <div className="dash-empty-icon">◐</div>
          <h2>Lead not found</h2>
          <p>This lead may not exist or may belong to a different campaign.</p>
        </div>
      </div>
    );
  }

  const consent = lead.consentEvidence as {
    voice?: { status: string }; whatsapp?: { status: string };
  };

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <Link href="/dashboard/leads" className="dash-link">← Leads</Link>
        <h1>{lead.name ?? lead.phoneE164}</h1>
        <span className={`badge ${STATUS_COLORS[lead.status] ?? "badge--gray"}`}>{lead.status}</span>
      </div>

      <section className="dash-card">
        <h2>Contact</h2>
        <dl className="detail-grid">
          {lead.name && <><dt>Name</dt><dd>{lead.name}</dd></>}
          <dt>Phone</dt><dd>{lead.phoneE164}</dd>
          <dt>Source</dt><dd>{lead.source}</dd>
          {lead.externalReference && <><dt>External ref</dt><dd>{lead.externalReference}</dd></>}
          <dt>Added</dt><dd>{new Date(lead.createdAt).toLocaleString("en-IN")}</dd>
        </dl>
      </section>

      <section className="dash-card">
        <h2>Call history</h2>
        <dl className="detail-grid">
          <dt>Attempts</dt><dd>{lead.attemptCount}</dd>
          <dt>Last attempt</dt>
          <dd>{lead.lastAttemptAt ? new Date(lead.lastAttemptAt).toLocaleString("en-IN") : <span className="muted">Never</span>}</dd>
          <dt>Last outcome</dt>
          <dd>{lead.lastOutcome ?? <span className="muted">—</span>}</dd>
          <dt>Next attempt</dt>
          <dd>{lead.nextAttemptAt ? new Date(lead.nextAttemptAt).toLocaleString("en-IN") : <span className="muted">Not scheduled</span>}</dd>
        </dl>
        <div style={{ marginTop: "0.75rem" }}>
          <Link href={`/dashboard/calls?leadId=${lead.id}`} className="dash-btn">View call logs</Link>
        </div>
      </section>

      <section className="dash-card">
        <h2>Qualification</h2>
        {lead.qualification ? (
          <dl className="detail-grid">
            <dt>Class</dt>
            <dd><span className={`badge ${QUAL_COLORS[lead.qualification] ?? "badge--gray"}`}>{lead.qualification}</span></dd>
            <dt>Score</dt>
            <dd>{lead.qualificationScore != null ? `${lead.qualificationScore} / 10` : <span className="muted">—</span>}</dd>
          </dl>
        ) : (
          <p className="muted">Not yet qualified — occurs after a completed call.</p>
        )}
      </section>

      <section className="dash-card">
        <h2>Consent</h2>
        <dl className="detail-grid">
          <dt>Voice call</dt>
          <dd><span className={`badge ${consent.voice?.status === "granted" ? "badge--green" : "badge--gray"}`}>
            {consent.voice?.status ?? "unknown"}
          </span></dd>
          <dt>WhatsApp</dt>
          <dd><span className={`badge ${consent.whatsapp?.status === "granted" ? "badge--green" : "badge--gray"}`}>
            {consent.whatsapp?.status ?? "unknown"}
          </span></dd>
        </dl>
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
          Consent is checked before each call. Do-not-call status prevents all future attempts.
        </p>
      </section>

      <section className="dash-card">
        <h2>Actions</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {lead.status !== "do_not_call" && (
            <button className="dash-btn" disabled={busy} onClick={() => void setStatus("do_not_call")}>
              Mark do-not-call
            </button>
          )}
          {lead.status === "do_not_call" && (
            <button className="dash-btn" disabled={busy} onClick={() => void setStatus("new")}>
              Remove do-not-call
            </button>
          )}
          {["exhausted"].includes(lead.status) && (
            <button className="dash-btn" disabled={busy} onClick={() => void setStatus("new")}>
              Reset to new
            </button>
          )}
          <Link href={`/dashboard/campaigns/${lead.campaignId}`} className="dash-btn">View campaign</Link>
        </div>
        {message && <p role="status" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>{message}</p>}
      </section>
    </div>
  );
}
