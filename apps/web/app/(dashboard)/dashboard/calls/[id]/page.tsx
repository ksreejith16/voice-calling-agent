import Link from "next/link";
import { getCall } from "../../../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  completed: "badge--green", connected: "badge--blue", failed: "badge--red",
  cancelled: "badge--gray", no_answer: "badge--yellow", busy: "badge--yellow",
  queued: "badge--gray", dialing: "badge--blue", ringing: "badge--blue",
};

const SETTLEMENT_COLORS: Record<string, string> = {
  settled: "badge--green", reserved: "badge--blue",
  released: "badge--yellow", unreserved: "badge--gray",
};

function fmt(val: string | null | undefined) {
  if (!val) return <span className="muted">—</span>;
  return <>{new Date(val).toLocaleString("en-IN")}</>;
}

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let call;
  try { call = await getCall(id); } catch { call = null; }

  if (!call) {
    return (
      <div className="dash-page">
        <div className="dash-page-header">
          <Link href="/dashboard/calls" className="dash-link">← Calls</Link>
        </div>
        <div className="dash-empty">
          <div className="dash-empty-icon">◉</div>
          <h2>Call not found</h2>
          <p>This call record may have been removed or does not belong to your organisation.</p>
        </div>
      </div>
    );
  }

  const duration = call.connectedDurationSeconds != null ? (() => {
    const m = Math.floor(call.connectedDurationSeconds! / 60);
    const s = call.connectedDurationSeconds! % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  })() : null;

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <Link href="/dashboard/calls" className="dash-link">← Calls</Link>
        <h1>Call #{call.attemptNumber}</h1>
        <span className={`badge ${STATUS_COLORS[call.status] ?? "badge--gray"}`}>{call.status}</span>
      </div>

      <section className="dash-card">
        <h2>Overview</h2>
        <dl className="detail-grid">
          <dt>Status</dt>
          <dd><span className={`badge ${STATUS_COLORS[call.status] ?? "badge--gray"}`}>{call.status}</span></dd>

          <dt>Settlement</dt>
          <dd><span className={`badge ${SETTLEMENT_COLORS[call.settlementStatus] ?? "badge--gray"}`}>{call.settlementStatus}</span></dd>

          <dt>Provider</dt>
          <dd>{call.provider ?? <span className="muted">—</span>}</dd>

          <dt>Provider call ID</dt>
          <dd>{call.providerCallId ? <code>{call.providerCallId}</code> : <span className="muted">—</span>}</dd>

          {call.errorCode && (
            <><dt>Error</dt><dd><code>{call.errorCode}</code></dd></>
          )}
        </dl>
      </section>

      <section className="dash-card">
        <h2>Timing</h2>
        <dl className="detail-grid">
          <dt>Queued</dt><dd>{fmt(call.queuedAt)}</dd>
          <dt>Started</dt><dd>{fmt(call.startedAt)}</dd>
          <dt>Connected</dt><dd>{fmt(call.connectedAt)}</dd>
          <dt>Ended</dt><dd>{fmt(call.endedAt)}</dd>
          <dt>Connected duration</dt><dd>{duration ?? <span className="muted">—</span>}</dd>
          <dt>Billable seconds</dt><dd>{call.billableSeconds}</dd>
          <dt>Billing quantum</dt><dd>{call.billingQuantumSeconds}s</dd>
          <dt>Max call duration</dt><dd>{Math.floor(call.maxConnectedDurationSeconds / 60)}m {call.maxConnectedDurationSeconds % 60}s</dd>
        </dl>
      </section>

      <section className="dash-card">
        <h2>Billing</h2>
        <dl className="detail-grid">
          <dt>Rate</dt><dd>₹{(Number(call.ratePaisePerMinute) / 100).toFixed(2)} / min</dd>
          <dt>Charged</dt><dd>₹{(Number(call.chargedPaise) / 100).toFixed(2)}</dd>
          <dt>Settled at</dt><dd>{fmt(call.settledAt)}</dd>
        </dl>
      </section>

      <section className="dash-card">
        <h2>Links</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href={`/dashboard/leads/${call.leadId}`} className="dash-btn">View lead</Link>
          <Link href={`/dashboard/campaigns/${call.campaignId}`} className="dash-btn">View campaign</Link>
        </div>
      </section>
    </div>
  );
}
