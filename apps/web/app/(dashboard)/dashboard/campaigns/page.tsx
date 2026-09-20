import Link from "next/link";
import { getCampaigns } from "../../../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  running: "badge--green", draft: "badge--gray", paused: "badge--yellow",
  completed: "badge--blue", archived: "badge--gray", scheduled: "badge--purple",
};

export default async function CampaignsPage() {
  let campaigns;
  try { campaigns = await getCampaigns(); } catch { campaigns = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Campaigns</h1>
        <span className="dash-page-sub">Outbound calling campaigns</span>
        <Link href="/dashboard/campaigns/new" className="dash-btn dash-btn--primary">+ New campaign</Link>
      </div>

      {!campaigns || campaigns.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◉</div>
          <h2>No campaigns yet</h2>
          <p>
            A campaign connects an agent to a list of leads and a calling schedule.
            You need at least one campaign to start making calls.
          </p>
          <Link href="/dashboard/campaigns/new" className="dash-btn dash-btn--primary">Create first campaign</Link>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr><th>Name</th><th>Status</th><th>Language</th><th>Rate</th><th>Created</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="dash-table-primary">
                    <Link href={`/dashboard/campaigns/${c.id}`} className="dash-link">{c.name}</Link>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[c.status] ?? "badge--gray"}`}>{c.status}</span>
                  </td>
                  <td>{c.language}</td>
                  <td>₹{(Number(c.ratePaisePerMinute) / 100).toFixed(2)}/min</td>
                  <td>{new Date(c.createdAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
