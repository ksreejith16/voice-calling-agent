import Link from "next/link";
import type { ReactNode } from "react";

export function VoiceMark() {
  return (
    <span className="voice-mark" aria-hidden="true">
      <i /><i /><i /><i /><i />
    </span>
  );
}

export function AppShell({
  active,
  children,
}: {
  active: "overview" | "setup";
  children: ReactNode;
}) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="India Voice home">
          <VoiceMark />
          <span>India Voice<span className="brand-caption">BUSINESS WORKSPACE</span></span>
        </Link>
        <div className="workspace-label"><span className="workspace-avatar">IV</span><span>Local workspace<small>Development environment</small></span></div>
        <nav aria-label="Main navigation">
          <p className="nav-label">WORKSPACE</p>
          <Link className={`nav-item ${active === "overview" ? "active" : ""}`} href="/" aria-current={active === "overview" ? "page" : undefined}>
            <span aria-hidden="true">◫</span> Overview
          </Link>
          <Link className={`nav-item ${active === "setup" ? "active" : ""}`} href="/setup" aria-current={active === "setup" ? "page" : undefined}>
            <span aria-hidden="true">⚙</span> Setup guide
          </Link>
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">BUILT FOR INDIA</span>
          <p>Conversations that feel local.</p>
          <span>Telugu · Hindi · Indian English</span>
        </div>
        <div className="sidebar-footer"><span className="dot" /> Phase 1 · Foundation</div>
      </aside>
      <div className="main-frame">
        <header className="topbar">
          <div>Workspace <span className="breadcrumb-slash">/</span> <strong>{active === "overview" ? "Overview" : "Setup guide"}</strong></div>
          <span className="environment-tag">LOCAL DEVELOPMENT</span>
        </header>
        <main id="main-content">{children}</main>
        <footer className="page-footer">India Voice <span>Phase 1 · Deliverables 1 &amp; 2</span></footer>
      </div>
    </div>
  );
}
