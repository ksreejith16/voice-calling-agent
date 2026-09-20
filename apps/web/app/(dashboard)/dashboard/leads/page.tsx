import { getLeads } from "../../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  new: "badge--gray", queued: "badge--blue", calling: "badge--yellow",
  contacted: "badge--purple", qualified: "badge--green", unqualified: "badge--red",
  do_not_call: "badge--red", exhausted: "badge--gray",
};

export default async function LeadsPage() {
  let leads;
  try { leads = await getLeads(); } catch { leads = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Leads</h1>
        <span className="dash-page-sub">Your contact list</span>
      </div>

      {!leads || leads.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◐</div>
          <h2>No leads yet</h2>
          <p>
            Leads are the people your AI will call. Add them via the API or
            by creating a campaign and uploading a CSV. Consent status and
            do-not-call rules are enforced before each call.
          </p>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name / Phone</th><th>Status</th><th>Qualification</th>
                <th>Attempts</th><th>Last attempt</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="dash-table-primary">{l.name ?? l.phoneE164}</div>
                    {l.name && <div className="muted">{l.phoneE164}</div>}
                  </td>
                  <td><span className={`badge ${STATUS_COLORS[l.status] ?? "badge--gray"}`}>{l.status}</span></td>
                  <td>{l.qualification ?? <span className="muted">—</span>}
                    {l.qualificationScore != null && <> ({l.qualificationScore}/10)</>}
                  </td>
                  <td>{l.attemptCount}</td>
                  <td>{l.lastAttemptAt ? new Date(l.lastAttemptAt).toLocaleDateString("en-IN") : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
