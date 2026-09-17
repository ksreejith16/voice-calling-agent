import Link from "next/link";

const industries = [
  {
    icon: "🏠",
    name: "Real Estate",
    tagline: "Convert inquiries into site visits",
    details: [
      "Qualify buyers and renters instantly",
      "Schedule property viewings automatically",
      "Follow up on every enquiry — even at midnight",
    ],
  },
  {
    icon: "🎓",
    name: "Education",
    tagline: "Turn applications into admissions",
    details: [
      "Answer common admission questions 24×7",
      "Counsel prospective students in their language",
      "Reduce counsellor workload by 60 %",
    ],
  },
  {
    icon: "🏪",
    name: "Small Business",
    tagline: "Serve customers around the clock",
    details: [
      "Handle product queries and bookings",
      "Run promotional campaigns automatically",
      "Scale without hiring more staff",
    ],
  },
];

const features = [
  {
    icon: "🗣️",
    title: "Naturally multilingual",
    body: "The AI follows the caller's lead — switching between Telugu, Hindi, and English mid-sentence the way Indians actually speak.",
  },
  {
    icon: "⚡",
    title: "Sub-500 ms response",
    body: "Sarvam Saaras realtime speech recognition and Bulbul v3 synthesis target a response the caller hears in under half a second.",
  },
  {
    icon: "🔕",
    title: "Handles interruptions",
    body: "Callers can cut in at any time. The AI stops, listens, and responds to the new question — just like a trained agent would.",
  },
  {
    icon: "📋",
    title: "Every call reviewed",
    body: "Timestamped transcripts, qualification scores, extracted information, and call recordings — automatically, for every call.",
  },
  {
    icon: "💬",
    title: "WhatsApp follow-up",
    body: "After a call, send authorised brochures or appointment confirmations directly on WhatsApp with a single campaign setting.",
  },
  {
    icon: "₹",
    title: "Prepaid, per-second billing",
    body: "Load INR funds to your wallet. Charges are reserved before each call and settled to the second. No surprises.",
  },
];

const steps = [
  {
    n: "01",
    title: "Upload your leads",
    body: "Import a CSV or connect your CRM via webhook. Set voice and WhatsApp consent once per campaign.",
  },
  {
    n: "02",
    title: "Configure the AI agent",
    body: "Choose language, voice, goals, questions to capture, calling schedule, and retry rules. No coding needed.",
  },
  {
    n: "03",
    title: "AI calls. You review.",
    body: "Calls go out automatically. Review transcripts, qualification scores, and outcomes from your dashboard.",
  },
];

export default function LandingPage() {
  return (
    <div className="lp-root">
      {/* ── Navigation ─────────────────────────────────────────── */}
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <span className="lp-logo">
            <span className="voice-mark" aria-hidden="true">
              <i /><i /><i /><i /><i />
            </span>
            India Voice
          </span>
          <nav className="lp-nav-links" aria-label="Site navigation">
            <Link href="#how-it-works" className="lp-nav-link">How it works</Link>
            <Link href="#industries" className="lp-nav-link">Industries</Link>
            <Link href="/setup" className="lp-nav-link">Developers</Link>
          </nav>
          <a href="mailto:hello@indiavoice.ai?subject=Early access request" className="button button-primary lp-demo-btn">
            Request demo <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>

      <main>
        {/* ── Hero ───────────────────────────────────────────────── */}
        <section className="lp-hero" aria-labelledby="hero-heading">
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-text">
              <span className="lp-badge">AI-POWERED · MULTILINGUAL · INDIAN</span>
              <h1 id="hero-heading" className="lp-hero-h1">
                Call more leads.<br />In their language.
              </h1>
              <p className="lp-hero-sub">
                India Voice automates outbound calls for real estate firms, schools,
                and small businesses — in Telugu, Hindi, English, and Tenglish.
                Your AI agent works 24×7 and never misses a follow-up.
              </p>
              <div className="lp-hero-actions">
                <a
                  href="mailto:hello@indiavoice.ai?subject=Early access request"
                  className="button button-primary lp-hero-cta"
                >
                  Get early access
                </a>
                <a href="#how-it-works" className="button button-secondary">
                  See how it works
                </a>
              </div>
              <div className="lp-lang-row" aria-label="Supported languages">
                <span className="lp-lang-pill">తెలుగు</span>
                <span className="lp-lang-pill">हिंदी</span>
                <span className="lp-lang-pill">English</span>
                <span className="lp-lang-pill lp-lang-pill-accent">Tenglish ✦</span>
              </div>
            </div>

            <div className="lp-hero-art" aria-hidden="true">
              <div className="wave-ring ring-one" />
              <div className="wave-ring ring-two" />
              <div className="wave-ring ring-three" />
              <div className="waveform">
                <i /><i /><i /><i /><i /><i /><i /><i /><i />
              </div>
              <div className="lp-call-card">
                <span className="lp-call-dot" />
                <div>
                  <strong>AI Agent calling…</strong>
                  <p>నమస్కారం! మీకు ఏదైనా సహాయం చేయగలనా?</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Social proof strip ──────────────────────────────────── */}
        <div className="lp-strip">
          <div className="lp-container lp-strip-inner">
            <span>Targets p95 response &lt; 500 ms</span>
            <span className="lp-strip-dot" aria-hidden="true" />
            <span>Sarvam Saaras Realtime STT</span>
            <span className="lp-strip-dot" aria-hidden="true" />
            <span>Sarvam Bulbul v3 TTS</span>
            <span className="lp-strip-dot" aria-hidden="true" />
            <span>Silero VAD · LiveKit media</span>
            <span className="lp-strip-dot" aria-hidden="true" />
            <span>Prepaid INR billing · per-second charges</span>
          </div>
        </div>

        {/* ── Industries ─────────────────────────────────────────── */}
        <section id="industries" className="lp-section" aria-labelledby="industries-heading">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">WHO IT IS FOR</span>
              <h2 id="industries-heading" className="lp-section-h2">
                Built for businesses that run on phone calls.
              </h2>
              <p className="lp-section-sub">
                If your team spends hours dialling leads, India Voice can do that work — faster,
                consistently, and in the language your customers prefer.
              </p>
            </div>
            <div className="lp-industry-grid">
              {industries.map((ind) => (
                <article key={ind.name} className="lp-industry-card">
                  <span className="lp-industry-icon">{ind.icon}</span>
                  <h3 className="lp-industry-name">{ind.name}</h3>
                  <p className="lp-industry-tagline">{ind.tagline}</p>
                  <ul className="lp-industry-list">
                    {ind.details.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ───────────────────────────────────────────── */}
        <section className="lp-section lp-section-alt" aria-labelledby="features-heading">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">CAPABILITIES</span>
              <h2 id="features-heading" className="lp-section-h2">
                Everything a calling team does — automated.
              </h2>
            </div>
            <div className="lp-feature-grid">
              {features.map((f) => (
                <article key={f.title} className="lp-feature-card">
                  <span className="lp-feature-icon">{f.icon}</span>
                  <h3 className="lp-feature-title">{f.title}</h3>
                  <p className="lp-feature-body">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────── */}
        <section id="how-it-works" className="lp-section" aria-labelledby="how-heading">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">HOW IT WORKS</span>
              <h2 id="how-heading" className="lp-section-h2">Up and running in minutes.</h2>
              <p className="lp-section-sub">No coding. No telephony expertise. Just configure and launch.</p>
            </div>
            <ol className="lp-steps-list" aria-label="Setup steps">
              {steps.map((s) => (
                <li key={s.n} className="lp-step">
                  <span className="lp-step-num">{s.n}</span>
                  <div>
                    <h3 className="lp-step-title">{s.title}</h3>
                    <p className="lp-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── CTA banner ─────────────────────────────────────────── */}
        <section className="lp-cta-banner" aria-labelledby="cta-heading">
          <div className="lp-container lp-cta-inner">
            <div>
              <h2 id="cta-heading" className="lp-cta-h2">
                Ready to automate your lead calling?
              </h2>
              <p className="lp-cta-sub">
                Early businesses get priority onboarding and input into the product roadmap.
              </p>
            </div>
            <a
              href="mailto:hello@indiavoice.ai?subject=Early access request"
              className="button button-primary lp-cta-btn"
            >
              Request early access <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo">
              <span className="voice-mark voice-mark-sm" aria-hidden="true">
                <i /><i /><i /><i /><i />
              </span>
              India Voice
            </span>
            <span className="lp-footer-sub">Built for Bharat.</span>
          </div>
          <div className="lp-footer-links">
            <Link href="/setup" className="lp-footer-link">Developer setup</Link>
            <a href="mailto:hello@indiavoice.ai" className="lp-footer-link">Contact</a>
          </div>
          <p className="lp-footer-legal">
            Phase 1 foundation · Voice prototype under development ·
            Latency targets not yet measured in production
          </p>
        </div>
      </footer>
    </div>
  );
}
