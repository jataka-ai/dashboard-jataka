import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectSalesforce,
  getSalesforceRecordContext,
  resolveSalesforceEnvironment,
  syncSalesforceRecordContext,
} from "./salesforce-api";

describe("Salesforce record context API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the authenticated record coverage manifest without caching", async () => {
    const payload = { status: "COMPLETE", objects: { percentComplete: 100 } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSalesforceRecordContext("token")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/integrations/salesforce/record-context"),
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer token" },
      }),
    );
  });

  it("distinguishes incremental sync from full reconciliation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncSalesforceRecordContext("token", false);
    await syncSalesforceRecordContext("token", true);

    expect(fetchMock.mock.calls[0][0]).toContain("forceFull=false");
    expect(fetchMock.mock.calls[1][0]).toContain("forceFull=true");
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token" },
      }),
    );
  });
});

describe("Salesforce OAuth environment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["https://customer.my.salesforce.com", "production"],
    ["https://customer-dev-ed.my.salesforce.com", "production"],
    ["https://customer--uat.sandbox.my.salesforce.com", "sandbox"],
    ["https://cs42.salesforce.com", "sandbox"],
  ] as const)("classifies %s as %s", (instanceUrl, expected) => {
    expect(
      resolveSalesforceEnvironment({
        connected: false,
        instance_url: instanceUrl,
      }),
    ).toBe(expected);
  });

  it("prefers an explicit environment from the connection contract", () => {
    expect(
      resolveSalesforceEnvironment({
        connected: false,
        environment: "sandbox",
        instance_url: "https://customer.my.salesforce.com",
      }),
    ).toBe("sandbox");
  });

  it("sends the typed environment to the authorization endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://test.salesforce.com/oauth" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { href: "" } });

    await connectSalesforce("token", "admin", "sandbox");

    expect(fetchMock.mock.calls[0][0]).toContain("role=admin&env=sandbox");
  });
});
