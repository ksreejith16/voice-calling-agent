import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { getApiStatus } from "../lib/api-status";

export const dynamic = "force-dynamic";

const plannedCapabilities = [
  { number: "01", title: "Voice campaigns", description: "Reach leads in Telugu, Hindi, and Indian English with natural conversations.", detail: "Calling & agent configuration" },
  { number: "02", title: "Lead workspace", description: "Bring leads, call outcomes, qualification, and follow-ups into one place.", detail: "CRM & conversation insights" },
  { number: "03", title: "Prepaid billing", description: "Track INR funds, call reservations, and itemized usage from your wallet.", detail: "Wallet & usage" },
];

export default async function OverviewPage() {
  const { health, readiness } = await getApiStatus();
  return (
    <AppShell active="overview">
      <section className="page-heading">
        <div><p className="eyebrow">YOUR WORKSPACE, TAKING SHAPE</p><h1>A foundation for better conversations.</h1><p>Start with the essentials. Build toward voice that speaks your customers’ language.</p></div>
        <Link className="button button-secondary" href="/setup">Setup guide <span aria-hidden="true">↗</span></Link>
      </section>

      <section className="hero-panel" aria-labelledby="foundation-title">
        <div className="hero-content">
          <span className="hero-tag"><span className="dot" /> FOUNDATION STAGE</span>
          <h2 id="foundation-title">Your workspace starts here.</h2>
          <p>This first release provides the application shell, API foundation, and tenant-scoped database structure. Business features will arrive in later phases.</p>
          <Link href="/setup" className="button button-primary">Explore the foundation <span aria-hidden="true">→</span></Link>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="wave-ring ring-one" /><div className="wave-ring ring-two" /><div className="wave-ring ring-three" /><div className="waveform"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span>MADE FOR CONVERSATION</span></div>
      </section>

      <section aria-labelledby="services-title" className="section-block">
        <div className="section-heading"><div><h2 id="services-title">Foundation status</h2><p>Live checks from this web server to your local API.</p></div><a className="text-link" href="/">Refresh status <span aria-hidden="true">↻</span></a></div>
        <div className="status-grid">
          <article className="status-card"><div className="card-top"><span className="small-icon" aria-hidden="true">⌘</span><span className={`status-pill ${health.available ? "success" : "neutral"}`}><span className="dot" />{health.available ? "Responding" : "Unavailable"}</span></div><h3>API service</h3><p>{health.available ? "The API health endpoint is responding." : "The API could not be reached or returned an error. Check the setup guide."}</p><span className="card-detail">Health check</span></article>
          <article className="status-card"><div className="card-top"><span className="small-icon" aria-hidden="true">▤</span><span className={`status-pill ${readiness.available ? "success" : "neutral"}`}><span className="dot" />{readiness.available ? "Ready" : "Not ready"}</span></div><h3>Service readiness</h3><p>{readiness.available ? "The API reports that its required dependencies are available." : "Readiness is not confirmed. Start the API and its required local services."}</p><span className="card-detail">Dependency check</span></article>
          <article className="status-card"><div className="card-top"><span className="small-icon" aria-hidden="true">♫</span><span className="status-pill amber"><span className="dot" />Awaiting review</span></div><h3>Voice worker</h3><p>The Python LiveKit and Sarvam worker begins after review of this foundation.</p><span className="card-detail">Deliverable 3</span></article>
        </div>
        <p className="check-time">Checked <time dateTime={health.checkedAt}>{health.checkedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time>. These checks do not verify voice or payment integrations.</p>
      </section>

      <section className="section-block" aria-labelledby="next-title">
        <div className="section-heading"><div><h2 id="next-title">What comes next</h2><p>The product direction for upcoming phases.</p></div><span className="muted-label">PLANNED CAPABILITIES</span></div>
        <div className="capability-grid">{plannedCapabilities.map((capability) => <article key={capability.number} className="capability-card"><span className="capability-number">{capability.number}</span><h3>{capability.title}</h3><p>{capability.description}</p><span className="card-detail">{capability.detail}</span></article>)}</div>
      </section>

      <aside className="review-note"><span className="review-symbol" aria-hidden="true">◎</span><div><h2>One review before the next step.</h2><p>Review the repository and database foundation before voice implementation. The agreed p95 response target is under 500 ms; voice performance has not been measured.</p></div><Link href="/setup#review" className="text-link">Review scope <span aria-hidden="true">→</span></Link></aside>
    </AppShell>
  );
}
