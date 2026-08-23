import { describe, expect, it } from "vitest";
import {
  isDashboardPersona,
  personaCanSeePath,
  personaCanSeeRoute,
  personaLandingRoute,
} from "./dashboard-persona";

describe("dashboard persona navigation", () => {
  it("preserves every route for Master", () => {
    expect(personaCanSeeRoute("MASTER", "/anything-added-later")).toBe(true);
  });

  it("keeps privileged operations out of Regular User", () => {
    expect(personaCanSeeRoute("REGULAR_USER", "/ask")).toBe(true);
    expect(personaCanSeeRoute("REGULAR_USER", "/integrations")).toBe(false);
    expect(personaCanSeeRoute("REGULAR_USER", "/audit-logs")).toBe(false);
    expect(personaCanSeePath("REGULAR_USER", "/support-ops/case-1")).toBe(
      false,
    );
    expect(personaLandingRoute("REGULAR_USER")).toBe("/ask");
  });

  it("rejects unknown persisted values", () => {
    expect(isDashboardPersona("ADMIN")).toBe(true);
    expect(isDashboardPersona("ROOT")).toBe(false);
  });
});
