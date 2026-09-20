import type { ReactNode } from "react";
import { getOverview } from "../../../lib/api";

function Rupees({ paise }: { paise: string | number }) {
  const r = Number(paise) / 100;
  return <span>₹{r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default async function OverviewPage() {
  let data;
  try {
    data = await getOverview();
  } catch {
    return (
      <div className="dash-page">
        <h1>Overview</h1>
        <div className="dash-notice dash-notice--warn">
          Could not load data. Make sure the API is running and you have run the database migration.
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Overview</h1>
        <span className="dash-page-sub">Real-time workspace summary</span>
      </div>

      <section className="dash-section">
        <h2 className="dash-section-title">Wallet</h2>
        <div className="stat-grid">
          <Stat label="Available balance" value={`₹${data.wallet.availableRupees.toFixed(2)}`} sub="Ready to use for calls" />
          <Stat label="Posted balance" value={<Rupees paise={data.wallet.balancePaise} />} sub="Total credited" />
          <Stat label="Reserved" value={<Rupees paise={data.wallet.reservedPaise} />} sub="Held for active calls" />
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-section-title">Campaigns</h2>
        <div className="stat-grid">
          <Stat label="Running" value={data.campaigns.running} />
          <Stat label="Draft" value={data.campaigns.draft} />
          <Stat label="Paused" value={data.campaigns.paused} />
          <Stat label="Total" value={data.campaigns.total} />
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-section-title">Leads</h2>
        <div className="stat-grid">
          <Stat label="New" value={data.leads.new} />
          <Stat label="Qualified" value={data.leads.qualified} />
          <Stat label="Total" value={data.leads.total} />
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-section-title">Calls</h2>
        <div className="stat-grid">
          <Stat label="Completed" value={data.calls.completed} />
          <Stat label="Failed" value={data.calls.failed} />
          <Stat label="Total" value={data.calls.total} />
        </div>
      </section>
    </div>
  );
}
