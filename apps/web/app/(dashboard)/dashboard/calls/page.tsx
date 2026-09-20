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

export default async function CallsPage() {
  let calls;
  try { calls = await getCalls(); } catch { calls = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Calls</h1>
        <span className="dash-page-sub">Call history and outcomes</span>
      </div>

      {!calls || calls.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◑</div>
          <h2>No calls yet</h2>
          <p>
            Call history will appear here once your campaigns start making calls.
            Telephone integration (Exotel) is a future milestone — the current prototype
            uses the browser voice harness.
          </p>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Status</th><th>Duration</th><th>Charge</th>
                <th>Settlement</th><th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td><span className={`badge ${STATUS_COLORS[c.status] ?? "badge--gray"}`}>{c.status}</span></td>
                  <td><Duration seconds={c.connectedDurationSeconds} /></td>
                  <td>₹{(Number(c.chargedPaise) / 100).toFixed(2)}</td>
                  <td>{c.endedAt ? new Date(c.endedAt).toLocaleDateString("en-IN") : <span className="muted">—</span>}</td>
                  <td>{c.endedAt ? new Date(c.endedAt).toLocaleTimeString("en-IN") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
