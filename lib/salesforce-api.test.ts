import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSalesforceRecordContext,
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
