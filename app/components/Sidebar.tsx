"use client";

import { useUser, SignOutButton } from "@clerk/nextjs";
import { useState, useSyncExternalStore } from "react";
import {
  LayoutDashboard,
  Network,
  Activity,
  Plug,
  ChevronsLeft,
  ChevronsRight,
  Hexagon,
  ShieldCheck,
  Terminal,
  Wrench,
  Shield,
  Bot,
  MessageSquare,
  BookOpen,
  Headset,
  Sparkles,
  FileCheck2,
  GitCompareArrows,
  ChartNoAxesCombined,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  canViewRoiAnalytics,
  type DashboardRole,
} from "../lib/dashboard-role";
import {
  DASHBOARD_PERSONAS,
  DASHBOARD_PERSONA_LABELS,
  DEFAULT_DASHBOARD_PERSONA,
  getStoredDashboardPersona,
  personaCanSeePath,
  personaCanSeeRoute,
  personaLandingRoute,
  setStoredDashboardPersona,
  subscribeToDashboardPersona,
  type DashboardPersona,
} from "../lib/dashboard-persona";

interface SidebarProps {
  orgName: string;
  userRole: DashboardRole;
}

export default function Sidebar({ orgName, userRole }: SidebarProps) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const persona = useSyncExternalStore(
    subscribeToDashboardPersona,
    getStoredDashboardPersona,
    () => DEFAULT_DASHBOARD_PERSONA,
  );

  const changePersona = (nextPersona: DashboardPersona) => {
    setStoredDashboardPersona(nextPersona);
    if (!personaCanSeePath(nextPersona, pathname)) {
      router.push(personaLandingRoute(nextPersona));
    }
  };

  const allNavItems = [
    { label: "Overview", href: "/", icon: LayoutDashboard },
    { label: "Dependency Graph", href: "/dependency-graph", icon: Network },
    { label: "Active Tests", href: "/active-tests", icon: Activity },
    { label: "Public Status", href: "/status", icon: Activity },
    { label: "PR Risk Radar", href: "/pr-radar", icon: ShieldCheck },
    { label: "Security & Compliance", href: "/compliance", icon: Shield },
    { label: "Knowledge Q&A", href: "/knowledge-qa", icon: BookOpen },
    { label: "Ask Support", href: "/ask", icon: MessageSquare },
    { label: "Support Ops", href: "/support-ops", icon: Headset },
    ...(canViewRoiAnalytics(userRole)
      ? [
          {
            label: "ROI Analytics",
            href: "/roi-analytics",
            icon: ChartNoAxesCombined,
          },
        ]
      : []),
    { label: "Configuration Drift", href: "/configuration-drift", icon: GitCompareArrows },
    { label: "Auditor", href: "/auditor", icon: FileCheck2 },
    { label: "Auto Resolution", href: "/auto-resolution", icon: Bot },
    { label: "Auto Resolution Demo", href: "/auto-resolution-demo", icon: Sparkles },
    { label: "Developer Tools", href: "/developer-tools", icon: Terminal },
    { label: "Tech Debt Cleanup", href: "/tech-debt", icon: Wrench },
    { label: "Integrations", href: "/integrations", icon: Plug },
    { label: "Audit Logs", href: "/audit-logs", icon: Activity },
  ];
  const navItems = allNavItems.filter((item) =>
    personaCanSeeRoute(persona, item.href),
  );

  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || "U";

  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "User";

  return (
    <aside
      className={`sticky top-0 self-start flex flex-col h-screen bg-[var(--bg-surface)] border-r border-[var(--border-default)] transition-all duration-200 ${
        collapsed ? "w-[64px]" : "w-[240px]"
      }`}
    >
      {/* Brand Header */}
      <div className={`flex items-center gap-3 px-4 h-14 border-b border-[var(--border-default)] ${collapsed ? "justify-center px-0" : ""}`}>
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
          <Hexagon size={18} className="text-white" strokeWidth={2} />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {orgName || "Jataka"}
            </p>
            <p className="text-xs text-[var(--text-muted)] truncate capitalize">
              {DASHBOARD_PERSONA_LABELS[persona]} view
            </p>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            title="Collapse sidebar"
          >
            <ChevronsLeft size={14} />
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
            title="Expand sidebar"
          >
            <ChevronsRight size={14} />
          </button>
        )}
      </div>

      <div
        className={`border-b border-[var(--border-default)] ${
          collapsed ? "p-2" : "px-3 py-3"
        }`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--accent-light)]"
            title={`${DASHBOARD_PERSONA_LABELS[persona]} persona`}
            aria-label={`Current persona: ${DASHBOARD_PERSONA_LABELS[persona]}`}
          >
            <UsersRound size={17} />
          </button>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Dashboard persona
            </span>
            <div className="relative">
              <UsersRound
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--accent-light)]"
              />
              <select
                aria-label="Dashboard persona"
                value={persona}
                onChange={(event) =>
                  changePersona(event.target.value as DashboardPersona)
                }
                className="w-full appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] py-2 pl-9 pr-3 text-xs font-medium text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-hover)] focus:border-[var(--accent)]"
              >
                {DASHBOARD_PERSONAS.map((option) => (
                  <option key={option} value={option}>
                    {DASHBOARD_PERSONA_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          </label>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.split("#")[0]);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-hover)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent"
              } ${collapsed ? "justify-center px-0 mx-auto w-10 h-10" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon
                size={18}
                className={`flex-shrink-0 transition-colors ${
                  isActive ? "text-[var(--accent-light)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"
                }`}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User Footer */}
      <div className="border-t border-[var(--border-default)] px-3 py-3">
        <div
          className={`flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[var(--bg-card)] transition-colors ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--bg-card)] border border-[var(--border-default)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)]">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{displayName}</p>
              <SignOutButton>
                <button className="text-xs text-[var(--text-muted)] hover:text-[var(--error)] transition-colors">
                  Sign out
                </button>
              </SignOutButton>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
