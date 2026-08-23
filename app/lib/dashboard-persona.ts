export const DASHBOARD_PERSONAS = [
  "MASTER",
  "ADMIN",
  "SUPER_USER",
  "REGULAR_USER",
] as const;

export type DashboardPersona = (typeof DASHBOARD_PERSONAS)[number];

export const DEFAULT_DASHBOARD_PERSONA: DashboardPersona = "MASTER";
export const DASHBOARD_PERSONA_STORAGE_KEY = "jataka.dashboard.persona";
const DASHBOARD_PERSONA_EVENT = "jataka:dashboard-persona-change";

export const DASHBOARD_PERSONA_LABELS: Record<DashboardPersona, string> = {
  MASTER: "Master",
  ADMIN: "Admin",
  SUPER_USER: "Super User",
  REGULAR_USER: "Regular User",
};

const PERSONA_ROUTES: Record<Exclude<DashboardPersona, "MASTER">, Set<string>> = {
  ADMIN: new Set([
    "/",
    "/dependency-graph",
    "/active-tests",
    "/pr-radar",
    "/compliance",
    "/support-ops",
    "/roi-analytics",
    "/configuration-drift",
    "/auditor",
    "/auto-resolution",
    "/developer-tools",
    "/tech-debt",
    "/integrations",
    "/audit-logs",
  ]),
  SUPER_USER: new Set([
    "/",
    "/dependency-graph",
    "/active-tests",
    "/status",
    "/pr-radar",
    "/knowledge-qa",
    "/ask",
    "/auto-resolution",
  ]),
  REGULAR_USER: new Set(["/ask", "/knowledge-qa", "/status"]),
};

export function isDashboardPersona(value: unknown): value is DashboardPersona {
  return DASHBOARD_PERSONAS.includes(value as DashboardPersona);
}

export function personaCanSeeRoute(
  persona: DashboardPersona,
  href: string,
): boolean {
  return persona === "MASTER" || PERSONA_ROUTES[persona].has(href);
}

export function personaCanSeePath(
  persona: DashboardPersona,
  pathname: string,
): boolean {
  if (persona === "MASTER") return true;
  return Array.from(PERSONA_ROUTES[persona]).some(
    (route) =>
      pathname === route || (route !== "/" && pathname.startsWith(`${route}/`)),
  );
}

export function personaLandingRoute(persona: DashboardPersona): string {
  return persona === "REGULAR_USER" ? "/ask" : "/";
}

export function getStoredDashboardPersona(): DashboardPersona {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_PERSONA;
  try {
    const saved = window.localStorage?.getItem(DASHBOARD_PERSONA_STORAGE_KEY);
    return isDashboardPersona(saved) ? saved : DEFAULT_DASHBOARD_PERSONA;
  } catch {
    return DEFAULT_DASHBOARD_PERSONA;
  }
}

export function setStoredDashboardPersona(persona: DashboardPersona): void {
  try {
    window.localStorage?.setItem(DASHBOARD_PERSONA_STORAGE_KEY, persona);
  } catch {
    // The selected view still applies for this page when storage is unavailable.
  }
  window.dispatchEvent(new Event(DASHBOARD_PERSONA_EVENT));
}

export function subscribeToDashboardPersona(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DASHBOARD_PERSONA_STORAGE_KEY) onChange();
  };
  window.addEventListener(DASHBOARD_PERSONA_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(DASHBOARD_PERSONA_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}
