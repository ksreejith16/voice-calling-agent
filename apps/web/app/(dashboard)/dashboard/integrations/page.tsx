import { getIntegrations } from "../../../../lib/api";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  configured: { label: "Configured", cls: "badge--blue" },
  verified: { label: "Verified", cls: "badge--green" },
  not_configured: { label: "Not configured", cls: "badge--gray" },
  not_verified: { label: "Not verified", cls: "badge--yellow" },
  needs_attention: { label: "Needs attention", cls: "badge--red" },
};

export default async function IntegrationsPage() {
  let integrations;
  try { integrations = await getIntegrations(); } catch { integrations = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Integrations</h1>
        <span className="dash-page-sub">Provider connection status — honest current state</span>
      </div>

      <div className="dash-notice dash-notice--info">
        A provider is marked "configured" only when its credentials are present and have been tested.
        "Not verified" means credentials are present but have not been tested end-to-end.
      </div>

      {integrations ? (
        <div className="integration-list">
          {Object.entries(integrations).map(([key, info]) => {
            const statusInfo = STATUS_LABELS[info.status] ?? { label: info.status, cls: "badge--gray" };
            return (
              <div key={key} className="integration-row">
                <div className="integration-label">{info.label}</div>
                <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
                <div className="integration-note">{info.note}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dash-notice dash-notice--warn">Could not load integration status. Ensure the API is running.</div>
      )}
    </div>
  );
}
