/**
 * API client for Salesforce integration
 */

const BASE_API = process.env.NEXT_PUBLIC_API_BASE_URL;

export interface SalesforceConnectionResponse {
  connected: boolean;
  actorRole?: string; // NEW
  user_id?: string;
  org_id?: string;
  instance_url?: string;
  sf_username?: string;
  connected_at?: string;
  last_used_at?: string;
  status?: "ACTIVE" | "EXPIRED" | string;
  is_valid?: boolean;
  auth_error_message?: string | null;
  auth_expired_at?: string | null;
  environment?: SalesforceEnvironment;
}

export type SalesforceEnvironment = "production" | "sandbox";

export function resolveSalesforceEnvironment(
  connection: SalesforceConnectionResponse,
): SalesforceEnvironment {
  if (connection.environment) return connection.environment;

  try {
    const hostname = new URL(
      connection.instance_url || "",
    ).hostname.toLowerCase();
    if (
      hostname === "test.salesforce.com" ||
      hostname.endsWith(".sandbox.my.salesforce.com") ||
      /^cs\d+\.(?:salesforce|my\.salesforce)\.com$/.test(hostname)
    ) {
      return "sandbox";
    }
  } catch {
    // Existing rows may lack an instance URL; Salesforce OAuth defaults to production.
  }

  return "production";
}

export interface SalesforceIngestionTrustResponse {
  auth: {
    connected: boolean;
    status: string;
    error: string | null;
    expiredAt: string | null;
  };
  freshness: {
    freshAsOf: string | null;
    ageHours: number | null;
    stale: boolean;
    thresholdHours: number;
  };
  latestRun: null | {
    id: string;
    status: "RUNNING" | "PARTIAL" | "SUCCEEDED" | "FAILED" | string;
    currentStage: string;
    startedAt: string;
    completedAt: string | null;
    coverageSummary?: {
      accessibleContextPercent: number;
      definition: string;
      failures: number;
      schema: {
        completed: number;
        discovered: number;
        globallyVisible?: number;
        systemRestricted?: number;
        percent: number;
      };
      metadata: {
        completed: number;
        discovered: number;
        percent: number;
        skippedBinaryFiles: number;
      };
    } | null;
    apiBudget?: {
      status: string;
      max: number | null;
      remaining: number | null;
      used: number | null;
      usedPercent: number | null;
      observedAt: string;
      message?: string;
    } | null;
    failureSummary?: Array<{
      stage: string;
      message: string;
      retryable: boolean;
    }> | null;
  };
  strictCoverage?: {
    strictComplete: boolean;
    accounted: number;
    total: number;
    unaccounted: number;
    dimensions: Record<
      string,
      {
        total: number;
        complete: number;
        partial: number;
        failed: number;
        pending: number;
        percent: number;
      }
    >;
  } | null;
  latestBenchmark: null | {
    status: string;
    suiteVersion: string;
    completedAt: string | null;
    corpusSummary?: { valid?: boolean; caseCount?: number } | null;
    runtimeSummary?: {
      passSource?: string;
      metrics?: Record<string, number>;
    } | null;
  };
  benchmarkReady: boolean;
  benchmarkReadyChecks: Record<string, boolean>;
}

export interface SalesforceRecordContextResponse {
  status: "NOT_STARTED" | "RUNNING" | "PARTIAL" | "COMPLETE" | string;
  statusReadStatus?: "live" | "cached" | "stale";
  snapshotAsOf?: string;
  syncActive?: boolean;
  objects: {
    discovered: number;
    completed: number;
    inaccessible: number;
    failed: number;
    running: number;
    pending: number;
    percentComplete: number;
  };
  records: {
    current: number;
    deleted: number;
    stale: number;
    relationships: number;
  };
  realtime: {
    subscribedChannels: number;
    inaccessibleChannels: number;
    errorChannels: number;
    lastEventAt: string | null;
    channels: Array<{
      channel: string;
      status: string;
      replayId: string | number | null;
      lastEventAt: string | null;
      lastError: string | null;
    }>;
  };
  checkpoints: Array<{
    objectType: string;
    status: string;
    queryable: boolean;
    discoveredFields: number;
    includedFields: number;
    recordsScanned: number;
    watermark: string | null;
    lastReconciledAt: string | null;
    lastError: string | null;
  }>;
}

interface OAuthUrlResponse {
  url: string;
}

/**
 * Check Salesforce connection status for the current organization
 */
export async function getSalesforceStatus(authToken: string): Promise<SalesforceConnectionResponse[]> {
  const response = await fetch(`${BASE_API}/integrations/salesforce/status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to check Salesforce connection status');
  }

  return response.json();
}

export async function getSalesforceIngestionTrust(
  authToken: string,
): Promise<SalesforceIngestionTrustResponse> {
  const response = await fetch(
    `${BASE_API}/integrations/salesforce/ingestion-trust`,
    {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("Failed to load ingestion trust status");
  return response.json();
}

export async function retrySalesforceIngestion(
  authToken: string,
): Promise<void> {
  const response = await fetch(
    `${BASE_API}/integrations/salesforce/ingestion-trust/retry`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    },
  );
  if (!response.ok) throw new Error("Failed to retry Salesforce ingestion");
}

export async function getSalesforceRecordContext(
  authToken: string,
): Promise<SalesforceRecordContextResponse> {
  const response = await fetch(
    `${BASE_API}/integrations/salesforce/record-context`,
    {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("Failed to load Salesforce record context");
  return response.json();
}

export async function syncSalesforceRecordContext(
  authToken: string,
  forceFull = false,
): Promise<void> {
  const response = await fetch(
    `${BASE_API}/integrations/salesforce/record-context/sync?forceFull=${forceFull}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    },
  );
  if (!response.ok) throw new Error("Failed to start Salesforce record sync");
}

/**
 * Initiate Salesforce OAuth flow
 * Gets the authorization URL from backend and redirects user to Salesforce
 */
export async function connectSalesforce(
  authToken: string,
  role: string = "admin",
  environment: SalesforceEnvironment = "production",
): Promise<void> {
  try {
    const params = new URLSearchParams({ role, env: environment });
    const response = await fetch(
      `${BASE_API}/integrations/salesforce/auth-url?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get authorization URL');
    }

    const { url } = await response.json() as OAuthUrlResponse;

    // Now redirect the browser to Salesforce authorization page
    window.location.href = url;
  } catch (error: unknown) {
    console.error('Failed to initiate Salesforce OAuth:', error);
    throw error;
  }
}

/**
 * Manually trigger Salesforce schema sync for the current organization
 */
export async function syncSalesforceSchema(authToken: string): Promise<void> {
  const response = await fetch(`${BASE_API}/integrations/salesforce/sync-schema`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to sync schema');
  }
}

/**
 * Disconnect Salesforce for the current organization
 */
export async function disconnectSalesforce(authToken: string, role: string = 'admin'): Promise<void> {
  const response = await fetch(`${BASE_API}/integrations/salesforce/disconnect?role=${role}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to disconnect Salesforce');
  }
}
