import Link from "next/link";
import { getCalls } from "../../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  completed: "badge--green", connected: "badge--blue", failed: "badge--red",
  cancelled: "badge--gray", no_answer: "badge--yellow", busy: "badge--yellow",
  queued: "badge--gray", dialing: "badge--blue", ringing: "badge--blue",
};

function Duration({ seconds }: { seconds: number | null }) {
  if (seconds == null) return <span className="muted">—</span>;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return <span>{m > 0 ? `${m}m ` : ""}{s}s</span>;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string; leadId?: string }>;
}) {
  const { campaignId, leadId } = await searchParams;
  let calls;
  try { calls = await getCalls({ campaignId, leadId }); } catch { calls = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Calls</h1>
        <span className="dash-page-sub">
          {leadId ? "Filtered by lead" : campaignId ? "Filtered by campaign" : "All call history"}
        </span>
      </div>

      {(leadId || campaignId) && (
        <div className="dash-notice">
          {leadId && <>Showing calls for lead <code>{leadId}</code>.{" "}</>}
          {campaignId && <>Showing calls for campaign <code>{campaignId}</code>.{" "}</>}
          <Link href="/dashboard/calls" className="dash-link">Clear filter</Link>
        </div>
      )}

      {!calls || calls.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◑</div>
          <h2>No calls{leadId || campaignId ? " found" : " yet"}</h2>
          <p>
            {leadId || campaignId
              ? "No calls match the current filter."
              : "Call history will appear here once campaigns start making calls. Telephony integration (Exotel) is pending."}
          </p>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Status</th><th>Attempt</th><th>Duration</th>
                <th>Charge</th><th>Error</th><th>Queued</th><th></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td><span className={`badge ${STATUS_COLORS[c.status] ?? "badge--gray"}`}>{c.status}</span></td>
                  <td>#{c.attemptNumber}</td>
                  <td><Duration seconds={c.connectedDurationSeconds} /></td>
                  <td>₹{(Number(c.chargedPaise) / 100).toFixed(2)}</td>
                  <td>{c.errorCode ? <code style={{ fontSize: "0.75rem" }}>{c.errorCode}</code> : <span className="muted">—</span>}</td>
                  <td>{c.queuedAt ? new Date(c.queuedAt).toLocaleString("en-IN") : <span className="muted">—</span>}</td>
                  <td><Link href={`/dashboard/calls/${c.id}`} className="dash-link">Details</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
