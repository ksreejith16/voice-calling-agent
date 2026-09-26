import Link from "next/link";
import { getLeads } from "../../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  new: "badge--gray", queued: "badge--blue", calling: "badge--yellow",
  contacted: "badge--purple", qualified: "badge--green", unqualified: "badge--red",
  do_not_call: "badge--red", exhausted: "badge--gray",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string; status?: string }>;
}) {
  const { campaignId, status } = await searchParams;
  let leads;
  try { leads = await getLeads({ campaignId, status }); } catch { leads = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Leads</h1>
        <span className="dash-page-sub">
          {campaignId ? "Filtered by campaign" : "All leads"}
          {status ? ` · ${status}` : ""}
        </span>
        <Link href="/dashboard/leads/import" className="dash-btn dash-btn--primary">Import CSV</Link>
      </div>

      {campaignId && (
        <div className="dash-notice">
          Showing leads for campaign <code>{campaignId}</code>.{" "}
          <Link href="/dashboard/leads" className="dash-link">Clear filter</Link>
        </div>
      )}

      {!leads || leads.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◐</div>
          <h2>No leads{campaignId ? " in this campaign" : ""}</h2>
          <p>
            {campaignId
              ? "Import a CSV to add leads to this campaign."
              : "Leads are the people your AI will call. Add them via CSV import or the API."}
          </p>
          {campaignId && (
            <Link href={`/dashboard/leads/import?campaignId=${campaignId}`} className="dash-btn dash-btn--primary">
              Import CSV
            </Link>
          )}
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
                    <Link href={`/dashboard/leads/${l.id}`} className="dash-link dash-table-primary">{l.name ?? l.phoneE164}</Link>
                    {l.name && <div className="muted">{l.phoneE164}</div>}
                  </td>
                  <td><span className={`badge ${STATUS_COLORS[l.status] ?? "badge--gray"}`}>{l.status}</span></td>
                  <td>
                    {l.qualification ?? <span className="muted">—</span>}
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
