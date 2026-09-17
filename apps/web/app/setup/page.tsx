import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";

export const metadata: Metadata = { title: "Setup guide" };

export default function SetupPage() {
  return (
    <AppShell active="setup">
      <section className="page-heading"><div><p className="eyebrow">GET ORIENTED</p><h1>Your foundation, at a glance.</h1><p>A small starting point with clear boundaries for the next phase.</p></div><Link className="button button-secondary" href="/">Back to overview <span aria-hidden="true">→</span></Link></section>

      <section className="setup-panel" aria-labelledby="running-title"><div className="section-heading"><div><h2 id="running-title">Run the local workspace</h2><p>Use the root README for exact prerequisites, commands, and verification steps.</p></div></div><ol className="setup-steps"><li><div><h3>Configure your environment</h3><p>Copy the root environment example to your local environment file. Use separate migration and restricted application database credentials.</p></div></li><li><div><h3>Start the local services</h3><p>Start PostgreSQL and Redis using the configuration in <code>infra/</code>. Install the workspace dependencies, prepare the database roles, and apply the versioned migrations.</p></div></li><li><div><h3>Launch the applications</h3><p>The web app runs at <a href="http://localhost:3000">localhost:3000</a>. The API runs at <a href="http://localhost:3001/health">localhost:3001</a>. Return to the overview to check API health and readiness.</p></div></li></ol><div className="info-strip">External provider credentials are not needed to build the foundation. Keep credentials in server environment files.</div></section>

      <div className="setup-columns"><section className="setup-panel"><p className="eyebrow">DELIVERABLES 1 &amp; 2</p><h2>Foundation scope</h2><ul className="feature-list"><li>Next.js application shell</li><li>NestJS API with Fastify</li><li>PostgreSQL schema and migrations</li><li>Tenant isolation and restricted database access</li><li>Integer-paise wallet and reservation data model</li><li>Local infrastructure and verification instructions</li></ul><p className="panel-footnote">The repository verification results are recorded separately. An accessible page alone does not validate database constraints.</p></section><section className="setup-panel"><p className="eyebrow">FUTURE PHASES</p><h2>Business features to follow</h2><ul className="feature-list future"><li>Organization sign-in and authorization</li><li>Live voice and telephony integration</li><li>Verified payments and billing services</li><li>Campaign execution and lead ingestion</li><li>WhatsApp messages and automations</li><li>Recordings, transcripts, and call analysis</li></ul><p className="panel-footnote">This public local shell does not load tenant business data. Sign-in and server authorization are required before those features are exposed.</p></section></div>

      <section id="review" className="review-panel" aria-labelledby="review-title"><span className="hero-tag">REVIEW CHECKPOINT</span><h2 id="review-title">Voice implementation waits for your review.</h2><p>Deliverable 3 is the standalone Python LiveKit worker with Sarvam streaming speech and interruption handling. Review Deliverables 1 and 2 before authorizing that work.</p><p className="panel-footnote">Telugu, Hindi, Indian English, code-switching, and the under-500 ms p95 target require later provider and end-to-end testing.</p></section>
    </AppShell>
  );
}
