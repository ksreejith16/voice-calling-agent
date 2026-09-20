import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { getMe } from "../../lib/api";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "◈" },
  { href: "/dashboard/agents", label: "Agents", icon: "◎" },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: "◉" },
  { href: "/dashboard/leads", label: "Leads", icon: "◐" },
  { href: "/dashboard/calls", label: "Calls", icon: "◑" },
  { href: "/dashboard/wallet", label: "Wallet", icon: "◇" },
  { href: "/dashboard/integrations", label: "Integrations", icon: "◈" },
  { href: "/dashboard/settings", label: "Settings", icon: "◦" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let me;
  try {
    me = await getMe();
  } catch {
    redirect("/sign-in");
  }

  if (!me.provisioned) {
    redirect("/onboarding");
  }

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <span className="dash-logo">▶</span>
          <span className="dash-brand-name">India Voice</span>
        </div>
        <div className="dash-org">{me.organization?.name ?? "Workspace"}</div>
        <nav className="dash-nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="dash-nav-item">
              <span className="dash-nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dash-user">
          <UserButton />
          <span className="dash-role">{me.role ?? "member"}</span>
        </div>
      </aside>
      <main className="dash-main">{children}</main>
    </div>
  );
}
