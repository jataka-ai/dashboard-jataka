"use client";

import { useAuth } from "@clerk/nextjs";
import { useState, useEffect, useRef } from "react";
import {
  CheckCircle,
  Circle,
  Loader2,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  KeyRound,
  Copy,
  ShieldAlert,
  Trash2,
  Github,
  Cloud,
  Database,
  RadioTower,
  TerminalSquare,
  ChevronRight,
  Square,
} from "lucide-react";

// Assuming these API helpers exist in your project
import {
  getJiraStatus,
  connectJira,
  updateJiraProjectKey,
  disconnectJira,
  type JiraConnectionResponse,
} from "../../lib/jira-api";
import {
  getSalesforceStatus,
  getSalesforceIngestionTrust,
  getSalesforceRecordContext,
  connectSalesforce,
  disconnectSalesforce,
  resolveSalesforceEnvironment,
  retrySalesforceIngestion,
  syncSalesforceSchema,
  syncSalesforceRecordContext,
  type SalesforceConnectionResponse,
  type SalesforceIngestionTrustResponse,
  type SalesforceRecordContextResponse,
} from "../../lib/salesforce-api";
import Sidebar from "../components/Sidebar";

const BASE_API = process.env.NEXT_PUBLIC_API_BASE_URL;
const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME || "jataka-ai";
const GITHUB_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_NAME}/installations/new`;

type ApiKeyRecord = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  keyPreview: string;
};

type IngestionStatus = {
  brainId: string;
  graph: {
    node_count: number;
    relationship_count: number;
    file_count: number;
    github_files: number;
    salesforce_files: number;
    complete_files: number;
    parsing_files: number;
    failed_files: number;
    latest_write: string | null;
  };
  github: {
    status: string;
    repository: string | null;
    processed: number;
    total: number | null;
    failed: number;
    remaining?: number | null;
    retained?: number;
    progressScope?: "CURRENT_SCAN" | "RETAINED_GRAPH";
    scanId?: string | null;
  };
  salesforce: {
    status: string;
    stage: string | null;
    processed: number;
    total: number;
    failures: number;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export default function IntegrationsAndSetupPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [orgName, setOrgName] = useState("");
  const [userRole, setUserRole] = useState<"ARCHITECT" | "DEVELOPER" | "">("");

  // --- UI & Wizard State ---
  const [activeStep, setActiveStep] = useState(1);
  const [copiedSfdxCommand, setCopiedSfdxCommand] = useState<string | null>(
    null,
  );
  const [copiedYaml, setCopiedYaml] = useState(false);

  // --- GitHub State ---
  const [isGithubConnected, setIsGithubConnected] = useState(false);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);
  const [ingestionStatus, setIngestionStatus] =
    useState<IngestionStatus | null>(null);
  const [checkingIngestionStatus, setCheckingIngestionStatus] = useState(false);
  const [ingestionStatusError, setIngestionStatusError] = useState<
    string | null
  >(null);
  const [retryingGithubIngestion, setRetryingGithubIngestion] = useState(false);
  const [ingestionAction, setIngestionAction] = useState<
    "github-stop" | "salesforce-stop" | "salesforce-resume" | null
  >(null);

  // --- Salesforce State ---
  const [salesforceConnections, setSalesforceConnections] = useState<
    SalesforceConnectionResponse[]
  >([]);
  const [checkingSalesforce, setCheckingSalesforce] = useState(false);
  const [isSyncingSchema, setIsSyncingSchema] = useState(false);
  const [isSyncingDependencies, setIsSyncingDependencies] = useState(false);
  const [ingestionTrust, setIngestionTrust] =
    useState<SalesforceIngestionTrustResponse | null>(null);
  const [ingestionTrustReadError, setIngestionTrustReadError] = useState(false);
  const [ingestionTrustObservedAt, setIngestionTrustObservedAt] =
    useState<Date | null>(null);
  const ingestionTrustRequestId = useRef(0);
  const [checkingIngestionTrust, setCheckingIngestionTrust] = useState(false);
  const [retryingIngestion, setRetryingIngestion] = useState(false);
  const [recordContext, setRecordContext] =
    useState<SalesforceRecordContextResponse | null>(null);
  const [recordContextReadError, setRecordContextReadError] = useState(false);
  const [recordContextObservedAt, setRecordContextObservedAt] =
    useState<Date | null>(null);
  const recordContextRequestId = useRef(0);
  const [checkingRecordContext, setCheckingRecordContext] = useState(false);
  const [syncingRecordContext, setSyncingRecordContext] = useState(false);
  const [reconcilingRecordContext, setReconcilingRecordContext] =
    useState(false);

  // --- API Key State ---
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("Copado/GitHub Pipeline");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // --- Jira State ---
  const [jiraConnected, setJiraConnected] = useState(false);
  const [checkingJira, setCheckingJira] = useState(false);
  const [jiraInfo, setJiraInfo] = useState<JiraConnectionResponse | null>(null);
  const [editingProjectKey, setEditingProjectKey] = useState(false);
  const [newProjectKey, setNewProjectKey] = useState("");
  const [updatingJira, setUpdatingJira] = useState(false);

  // --- Progress Calculation ---
  const isSfAdminConnected = salesforceConnections.some(
    (c) => c.actorRole === "admin" && c.status !== "EXPIRED",
  );
  const expiredSalesforceConnections = salesforceConnections.filter(
    (c) => c.status === "EXPIRED",
  );
  const hasExpiredSalesforceConnection =
    expiredSalesforceConnections.length > 0;
  const hasActiveKeys = keys.some((k) => k.isActive);

  const completedSteps = [
    isGithubConnected,
    isSfAdminConnected,
    hasActiveKeys,
    copiedYaml,
    jiraConnected,
  ].filter(Boolean).length;
  const progressPercentage = (completedSteps / 5) * 100; // Tracking all 5 steps for 100%

  // --- Initialization & Fetching ---
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      const fetchOrg = async () => {
        const token = await getToken();
        if (token && BASE_API) {
          const syncRes = await fetch(`${BASE_API}/auth/sync`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            const orgData = syncData.org || syncData.organization || {};
            const rawRole = syncData.user?.role || syncData.orgRole || "";
            setOrgName(
              orgData.name ||
                syncData.orgName ||
                syncData.organizationName ||
                "Jataka",
            );
            setUserRole(
              rawRole === "senior" ||
                rawRole === "org:admin" ||
                rawRole === "admin"
                ? "ARCHITECT"
                : "DEVELOPER",
            );
          }
        }
      };

      fetchOrg();
      checkGithubConnection();
      checkJiraConnection();
      checkSalesforceConnection();
      checkIngestionTrust();
      checkRecordContext();
      fetchKeys();

      const params = new URLSearchParams(window.location.search);
      if (params.get("jira") === "connected") alert("✅ Jira connected!");
      if (params.get("salesforce") === "connected")
        alert("✅ Salesforce connected!");
      if (params.get("github") === "connected") {
        alert("✅ GitHub connected!");
        checkGithubConnection();
      }
      if (params.get("jira") === "error") {
        const message = params.get("message");
        alert(
          `❌ Jira connection failed${message ? `: ${decodeURIComponent(message)}` : ""}`,
        );
      }

      if (
        params.has("jira") ||
        params.has("salesforce") ||
        params.has("github")
      ) {
        window.history.replaceState({}, "", "/integrations");
      }
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void checkUnifiedIngestionStatus();
    void checkRecordContext();
    const interval = window.setInterval(() => {
      void checkUnifiedIngestionStatus();
      void checkRecordContext();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const interval = window.setInterval(() => {
      void checkIngestionTrust();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [isLoaded, isSignedIn]);

  const checkUnifiedIngestionStatus = async () => {
    setCheckingIngestionStatus(true);
    setIngestionStatusError(null);
    try {
      const token = await getToken();
      if (!token || !BASE_API) return;
      const response = await fetch(
        `${BASE_API}/integrations/github/ingestion-status`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Failed to load ingestion status");
      setIngestionStatus(await response.json());
    } catch (error) {
      console.error("Failed to load ingestion status", error);
      setIngestionStatusError(getErrorMessage(error));
    } finally {
      setCheckingIngestionStatus(false);
    }
  };

  const retryGithubIngestion = async () => {
    setRetryingGithubIngestion(true);
    setIngestionStatusError(null);
    try {
      const token = await getToken();
      if (!token || !BASE_API) throw new Error("Authentication is unavailable");
      const response = await fetch(
        `${BASE_API}/integrations/github/ingestion-retry`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.message || "Failed to resume GitHub ingestion",
        );
      }
      await checkUnifiedIngestionStatus();
    } catch (error) {
      console.error("Failed to resume GitHub ingestion", error);
      setIngestionStatusError(getErrorMessage(error));
    } finally {
      setRetryingGithubIngestion(false);
    }
  };

  const updateAutomaticIngestion = async (
    source: "github" | "salesforce",
    action: "stop" | "resume",
  ) => {
    const currentAction = `${source}-${action}` as typeof ingestionAction;
    setIngestionAction(currentAction);
    setIngestionStatusError(null);
    try {
      const token = await getToken();
      if (!token || !BASE_API) throw new Error("Authentication is unavailable");
      const endpoint =
        source === "github"
          ? action === "stop"
            ? "/integrations/github/ingestion-stop"
            : "/integrations/github/ingestion-retry"
          : action === "stop"
            ? "/integrations/salesforce/ingestion-trust/stop"
            : "/integrations/salesforce/ingestion-trust/retry";
      const response = await fetch(`${BASE_API}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.message || `Failed to ${action} ${source} ingestion`,
        );
      }
      await checkUnifiedIngestionStatus();
    } catch (error) {
      console.error(`Failed to ${action} ${source} ingestion`, error);
      setIngestionStatusError(getErrorMessage(error));
    } finally {
      setIngestionAction(null);
    }
  };

  // --- API Functions (GitHub) ---
  const checkGithubConnection = async () => {
    setCheckingGithub(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${BASE_API}/integrations/github/status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        setIsGithubConnected(Boolean(data.connected));
        const resolvedInstallationId =
          data.installationId ?? data.installation_id ?? null;
        setInstallationId(
          resolvedInstallationId ? String(resolvedInstallationId) : null,
        );
      }
    } catch (error) {
      console.error("Failed to fetch GitHub status", error);
      setIsGithubConnected(false);
    } finally {
      setCheckingGithub(false);
    }
  };

  const handleInstallGithub = () => {
    window.location.href = GITHUB_INSTALL_URL;
  };

  // --- API Functions (Keys) ---
  const fetchKeys = async () => {
    setKeysLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${BASE_API}/integrations/github/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(Array.isArray(data?.keys) ? data.keys : []);
      }
    } catch (error) {
      console.error("Failed to load API keys", error);
    } finally {
      setKeysLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return alert("Please enter a key name.");
    setCreatingKey(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${BASE_API}/integrations/github/api-keys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (!res.ok) throw new Error("Failed to create key");
      const data = await res.json();
      setGeneratedKey(data?.key || null);
      setCopiedKey(false);
      await fetchKeys();
    } catch {
      alert("Failed to create API key");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (
      !window.confirm(
        "Revoke this key? Existing CI/CD runs using it will fail.",
      )
    )
      return;
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(
        `${BASE_API}/integrations/github/api-keys/${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Failed to revoke key");
      await fetchKeys();
    } catch {
      alert("Failed to revoke API key");
    }
  };

  // --- API Functions (Salesforce) ---
  const checkSalesforceConnection = async () => {
    setCheckingSalesforce(true);
    try {
      const token = await getToken();
      const data = token ? await getSalesforceStatus(token) : [];
      setSalesforceConnections(data || []);
    } catch {
      setSalesforceConnections([]);
    } finally {
      setCheckingSalesforce(false);
    }
  };

  const checkIngestionTrust = async () => {
    const requestId = ++ingestionTrustRequestId.current;
    setCheckingIngestionTrust(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication unavailable");
      const response = await getSalesforceIngestionTrust(token);
      if (requestId !== ingestionTrustRequestId.current) return;
      setIngestionTrust(response);
      setIngestionTrustObservedAt(new Date());
      setIngestionTrustReadError(false);
    } catch {
      if (requestId === ingestionTrustRequestId.current) {
        setIngestionTrustReadError(true);
      }
    } finally {
      if (requestId === ingestionTrustRequestId.current) {
        setCheckingIngestionTrust(false);
      }
    }
  };

  const checkRecordContext = async () => {
    const requestId = ++recordContextRequestId.current;
    setCheckingRecordContext(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication unavailable");
      const response = await getSalesforceRecordContext(token);
      if (requestId !== recordContextRequestId.current) return;
      setRecordContext(response);
      setRecordContextObservedAt(new Date());
      setRecordContextReadError(false);
    } catch (error) {
      console.error("Failed to load Salesforce record context", error);
      if (requestId === recordContextRequestId.current) {
        setRecordContextReadError(true);
      }
    } finally {
      if (requestId === recordContextRequestId.current) {
        setCheckingRecordContext(false);
      }
    }
  };

  const handleRecordContextSync = async (forceFull: boolean) => {
    const token = await getToken();
    if (!token) return;
    const setBusy = forceFull
      ? setReconcilingRecordContext
      : setSyncingRecordContext;
    setBusy(true);
    try {
      await syncSalesforceRecordContext(token, forceFull);
      await checkRecordContext();
    } catch (error) {
      alert(`Failed to start record sync: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRetryIngestion = async () => {
    const token = await getToken();
    if (!token) return;
    setRetryingIngestion(true);
    try {
      await retrySalesforceIngestion(token);
      await checkIngestionTrust();
    } catch (error) {
      alert(`Failed to retry ingestion: ${getErrorMessage(error)}`);
    } finally {
      setRetryingIngestion(false);
    }
  };

  const handleConnectSalesforce = async (
    role: string,
    environment: "production" | "sandbox" = "production",
  ) => {
    const token = await getToken();
    if (token) await connectSalesforce(token, role, environment);
  };

  // 👇 ADD THIS NEW FUNCTION 👇
  const handleDisconnectSalesforce = async (role: string) => {
    if (!confirm("Are you sure you want to disconnect this role?")) return;
    const token = await getToken();
    if (!token) return;
    try {
      await disconnectSalesforce(token, role);
      await checkSalesforceConnection();
    } catch (error) {
      console.error("Failed to disconnect Salesforce role", error);
      alert("Failed to disconnect role.");
    }
  };

  const handleSyncSchemaData = async () => {
    const token = await getToken();
    if (!token) return;
    try {
      setIsSyncingSchema(true);
      await syncSalesforceSchema(token);
      alert(
        "Schema sync started! Standard and custom metadata are updating in the background.",
      );
    } catch (error: unknown) {
      alert(`Failed to sync schema: ${getErrorMessage(error)}`);
    } finally {
      setIsSyncingSchema(false);
    }
  };

  const handleSyncDependenciesData = async () => {
    const token = await getToken();
    if (!token) return;
    try {
      setIsSyncingDependencies(true);
      const res = await fetch(
        `${BASE_API}/integrations/salesforce/sync-dependencies`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Failed to start dependency sync");
      alert(
        "Impact Graph sync started! Navigating connections in the background. 🕸️",
      );
    } catch (error: unknown) {
      alert(`Failed to sync impact graph: ${getErrorMessage(error)}`);
    } finally {
      setIsSyncingDependencies(false);
    }
  };

  // --- API Functions (Jira) ---
  const checkJiraConnection = async () => {
    setCheckingJira(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await getJiraStatus(token);
      setJiraConnected(data.connected);
      if (data.connected) {
        setJiraInfo(data);
        setNewProjectKey(data.project_key || "");
      }
    } catch {
      setJiraConnected(false);
    } finally {
      setCheckingJira(false);
    }
  };

  const handleConnectJira = async () => {
    const token = await getToken();
    if (token) await connectJira(token);
  };

  const handleDisconnectJira = async () => {
    if (!confirm("Are you sure you want to disconnect Jira?")) return;
    const token = await getToken();
    if (!token) return;
    try {
      await disconnectJira(token);
      await checkJiraConnection();
    } catch {
      alert("Failed to disconnect Jira");
    }
  };

  const handleUpdateJiraKey = async () => {
    if (!newProjectKey.trim()) return alert("Project key cannot be empty.");
    const token = await getToken();
    if (!token) return;
    setUpdatingJira(true);
    try {
      await updateJiraProjectKey(
        { projectKey: newProjectKey.toUpperCase() },
        token,
      );
      setEditingProjectKey(false);
      await checkJiraConnection();
    } catch {
      alert("Failed to update Jira Project Key");
    } finally {
      setUpdatingJira(false);
    }
  };

  // --- Clipboard Helpers ---
  const copyToClipboard = async (
    text: string,
    setter: (val: boolean) => void,
  ) => {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 3000);
  };

  //const webhookUrl = 'https://api.jataka.ai/api/integrations/github/trigger';
  const displayInstallId = installationId
    ? installationId
    : '"YOUR_INSTALLATION_ID"';

  const yamlSnippet = `- name: Trigger Jataka AI UI Tests
  # Put this step AFTER your Salesforce deployment step (Gearset, Copado, or SFDX)
  run: |
    curl -X POST "\${{ secrets.JATAKA_API_URL }}/api/integrations/github/trigger" \\
      -H "Authorization: Bearer \${{ secrets.JATAKA_API_KEY }}" \\
      -H "Content-Type: application/json" \\
      -d '{
        "installation_id": ${displayInstallId}, 
        "repo_full_name": "\${{ github.repository }}",
        "branch": "\${{ github.head_ref || github.ref_name }}",
        "pr_number": \${{ github.event.pull_request.number || 'null' }},
        "test_mode": "\${{ vars.JATAKA_TEST_MODE || 'auto' }}",
        "action": "\${{ github.event.action }}",
        "before_sha": "\${{ github.event.before }}"
      }'`;

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Sidebar orgName={orgName} userRole={userRole} />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Setup & Integrations
            </h1>
            <p className="text-slate-400 text-sm md:text-base">
              Complete these steps to fully automate your AI testing pipeline.
            </p>
            {hasExpiredSalesforceConnection && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
                <span className="font-semibold">
                  Salesforce authentication expired.
                </span>{" "}
                Automated tests are paused until an admin reconnects Salesforce.
              </div>
            )}

            <div className="mt-6 bg-slate-800/50 rounded-full h-3 w-full border border-slate-700 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-500 ease-in-out relative"
                style={{ width: `${Math.min(progressPercentage, 100)}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
              </div>
            </div>
            <p className="text-xs text-blue-400 mt-2 font-medium tracking-wide">
              SETUP PROGRESS: {Math.round(Math.min(progressPercentage, 100))}%
            </p>
          </div>

          {!ingestionStatus && checkingIngestionStatus && (
            <section className="mb-8 rounded-2xl border border-cyan-500/20 bg-slate-950 p-8 text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-cyan-300" />
              <h2 className="mt-3 font-semibold text-white">
                Reading ingestion progress
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Checking GitHub, Salesforce, and the knowledge graph.
              </p>
            </section>
          )}

          {!ingestionStatus && ingestionStatusError && (
            <section className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5">
              <div>
                <h2 className="font-semibold text-amber-200">
                  Ingestion status is temporarily unavailable
                </h2>
                <p className="mt-1 text-sm text-amber-100/60">
                  {ingestionStatusError}
                </p>
              </div>
              <button
                onClick={() => void checkUnifiedIngestionStatus()}
                className="rounded-lg border border-amber-400/30 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-400/10"
              >
                Retry
              </button>
            </section>
          )}

          {ingestionStatus && (
            <section className="mb-8 overflow-hidden rounded-2xl border border-cyan-500/30 bg-slate-950 shadow-[0_20px_70px_-35px_rgba(34,211,238,0.65)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-cyan-950/60 via-slate-950 to-emerald-950/40 px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                    Live ingestion control
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {ingestionStatus.brainId}
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  {checkingIngestionStatus && (
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                  )}
                  Auto-refreshing every 5 seconds
                </div>
              </div>

              <div className="grid gap-4 p-5 lg:grid-cols-2">
                {[
                  {
                    name: "GitHub repository",
                    icon: Github,
                    status: ingestionStatus.github.status,
                    processed: ingestionStatus.github.processed,
                    total: ingestionStatus.github.total,
                    failed: ingestionStatus.github.failed,
                    remaining: ingestionStatus.github.remaining ?? null,
                    retained:
                      ingestionStatus.github.retained ??
                      ingestionStatus.graph.github_files,
                    progressScope:
                      ingestionStatus.github.progressScope ?? "CURRENT_SCAN",
                    detail:
                      ingestionStatus.github.repository ||
                      `${ingestionStatus.graph.github_files} repository files retained`,
                  },
                  {
                    name: "Salesforce org",
                    icon: Cloud,
                    status: ingestionStatus.salesforce.status,
                    processed: ingestionStatus.salesforce.processed,
                    total: ingestionStatus.salesforce.total,
                    failed: ingestionStatus.salesforce.failures,
                    remaining: null,
                    retained: ingestionStatus.graph.salesforce_files,
                    progressScope: "CURRENT_SCAN" as const,
                    detail:
                      ingestionStatus.salesforce.stage ||
                      `${ingestionStatus.graph.salesforce_files} Salesforce files retained`,
                  },
                ].map((source) => {
                  const total = source.total || 0;
                  const percent =
                    total > 0
                      ? Math.min(
                          100,
                          Math.round((source.processed / total) * 100),
                        )
                      : null;
                  const normalizedStatus = source.status.toUpperCase();
                  const running = [
                    "RUNNING",
                    "IN_PROGRESS",
                    "PENDING",
                    "QUEUED",
                  ].includes(normalizedStatus);
                  const stalled = normalizedStatus === "STALLED";
                  const stopped = normalizedStatus === "STOPPED";
                  const resumable = [
                    "STALLED",
                    "STOPPED",
                    "FAILED",
                    "PARTIAL",
                    "COMPLETED_WITH_ERRORS",
                  ].includes(normalizedStatus);
                  const notStarted = ["NOT_STARTED", "UNKNOWN"].includes(
                    normalizedStatus,
                  );
                  const sourceKey =
                    source.name === "GitHub repository"
                      ? "github"
                      : "salesforce";
                  const stopping = ingestionAction === `${sourceKey}-stop`;
                  const resuming =
                    sourceKey === "github"
                      ? retryingGithubIngestion
                      : ingestionAction === "salesforce-resume";
                  const SourceIcon = source.icon;
                  return (
                    <article
                      key={source.name}
                      className="rounded-xl border border-slate-800 bg-slate-900/80 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg border border-slate-700 bg-slate-950 p-2">
                            <SourceIcon className="h-5 w-5 text-cyan-300" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-white">
                              {source.name}
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {source.detail}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider ${running ? "bg-cyan-400/10 text-cyan-300" : stalled ? "bg-amber-400/10 text-amber-300" : notStarted ? "bg-slate-700 text-slate-300" : source.failed ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}
                        >
                          {running
                            ? "INGESTING"
                            : source.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${running ? "bg-cyan-400" : notStarted ? "bg-slate-600" : source.failed ? "bg-amber-400" : "bg-emerald-400"}`}
                          style={{
                            width: `${percent ?? (running ? 12 : notStarted ? 0 : 100)}%`,
                          }}
                        />
                      </div>
                      {source.name === "GitHub repository" ? (
                        <>
                          <div className="mt-2 flex justify-between text-xs text-slate-400">
                            <span>
                              Current scan: {source.processed.toLocaleString()}
                              {total
                                ? ` / ${total.toLocaleString()} verified`
                                : " verified"}
                            </span>
                            <span>
                              {percent === null
                                ? running
                                  ? "In progress"
                                  : stalled || stopped
                                    ? "Stopped"
                                    : notStarted
                                      ? "Not started"
                                      : "Complete"
                                : `${percent}%`}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                              <p className="text-slate-500">
                                Retained in graph
                              </p>
                              <p className="mt-1 font-semibold text-white">
                                {source.retained.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                              <p className="text-slate-500">
                                Remaining this scan
                              </p>
                              <p className="mt-1 font-semibold text-white">
                                {source.remaining === null
                                  ? "Unknown"
                                  : source.remaining.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                              <p className="text-slate-500">
                                Currently unresolved
                              </p>
                              <p
                                className={`mt-1 font-semibold ${source.failed ? "text-amber-300" : "text-emerald-300"}`}
                              >
                                {source.failed.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                              <p className="text-slate-500">Counter scope</p>
                              <p className="mt-1 font-semibold text-white">
                                {source.progressScope === "CURRENT_SCAN"
                                  ? "Current scan"
                                  : "Retained graph"}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-[11px] leading-5 text-slate-500">
                            Resume starts a new verification scan, so the
                            current-scan count may restart. Retained graph files
                            are not reset.
                          </p>
                        </>
                      ) : (
                        <div className="mt-2 flex justify-between text-xs text-slate-400">
                          <span>
                            {source.processed.toLocaleString()}
                            {total
                              ? ` / ${total.toLocaleString()}`
                              : " processed"}
                          </span>
                          <span>
                            {percent === null
                              ? running
                                ? "In progress"
                                : stalled || stopped
                                  ? "Stopped"
                                  : notStarted
                                    ? "Not started"
                                    : "Complete"
                              : `${percent}%`}
                            {source.failed ? ` · ${source.failed} failed` : ""}
                          </span>
                        </div>
                      )}
                      {running && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateAutomaticIngestion(sourceKey, "stop")
                          }
                          disabled={stopping}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {stopping ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                          Stop automatic ingestion
                        </button>
                      )}
                      {resumable && (
                        <button
                          type="button"
                          onClick={() =>
                            sourceKey === "github"
                              ? void retryGithubIngestion()
                              : void updateAutomaticIngestion(
                                  "salesforce",
                                  "resume",
                                )
                          }
                          disabled={resuming}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {resuming ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Resume automatic ingestion
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-px border-t border-slate-800 bg-slate-800 md:grid-cols-4">
                {[
                  ["Graph nodes", ingestionStatus.graph.node_count],
                  ["Relationships", ingestionStatus.graph.relationship_count],
                  ["Retained files", ingestionStatus.graph.file_count],
                  [
                    "Active / failed",
                    `${ingestionStatus.graph.parsing_files} / ${ingestionStatus.graph.failed_files}`,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-950 px-5 py-4">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-semibold text-white">
                      {typeof value === "number"
                        ? value.toLocaleString()
                        : value}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar / Stepper */}
            <div className="lg:w-1/3 flex-shrink-0">
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 sticky top-8">
                <nav className="space-y-2">
                  {[
                    {
                      id: 1,
                      title: "1. Connect GitHub",
                      icon: Github,
                      isDone: isGithubConnected,
                    },
                    {
                      id: 2,
                      title: "2. Connect Salesforce",
                      icon: Cloud,
                      isDone: isSfAdminConnected,
                    },
                    {
                      id: 3,
                      title: "3. Generate API Key",
                      icon: KeyRound,
                      isDone: hasActiveKeys,
                    },
                    {
                      id: 4,
                      title: "4. Configure CI/CD",
                      icon: TerminalSquare,
                      isDone: copiedYaml,
                    },
                    {
                      id: 5,
                      title: "5. Optional Settings",
                      icon: RefreshCw,
                      isDone: jiraConnected,
                    },
                  ].map((step) => (
                    <button
                      key={step.id}
                      onClick={() => setActiveStep(step.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left
                        ${activeStep === step.id ? "bg-blue-600/20 border border-blue-500/50 text-blue-300" : "hover:bg-slate-800/50 text-slate-400 border border-transparent"}
                    `}
                    >
                      {step.isDone ? (
                        <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 opacity-40 flex-shrink-0" />
                      )}
                      <span className="font-medium text-sm flex-1">
                        {step.title}
                      </span>
                      {activeStep === step.id && (
                        <ChevronRight className="w-4 h-4 opacity-50" />
                      )}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:w-2/3">
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 md:p-8 shadow-2xl min-h-[500px]">
                {/* --- STEP 1: GITHUB --- */}
                {activeStep === 1 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-2xl font-bold flex items-center gap-3">
                        <Github className="w-7 h-7" /> Connect GitHub
                      </h2>
                      <button
                        onClick={checkGithubConnection}
                        disabled={checkingGithub}
                        className="text-xs flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${checkingGithub ? "animate-spin" : ""}`}
                        />{" "}
                        Refresh Status
                      </button>
                    </div>
                    <p className="text-slate-400 mb-6">
                      Install the Jataka App on your GitHub repository to allow
                      us to read PR details, monitor your branch health, and
                      post test results back to your PRs.
                    </p>

                    <div className="bg-slate-950 border border-slate-700 rounded-xl p-5 mb-6">
                      <div className="flex justify-between items-center mb-4">
                        <div>
                          <h3 className="font-semibold text-white">
                            GitHub App
                          </h3>
                          <p className="text-xs text-slate-400">
                            Required for reading PRs and posting status checks
                          </p>
                        </div>
                        {checkingGithub ? (
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        ) : isGithubConnected ? (
                          <div className="flex items-center gap-2 text-green-400 bg-green-400/10 px-3 py-1.5 rounded-full text-sm">
                            <CheckCircle className="w-4 h-4" /> Connected
                          </div>
                        ) : (
                          <button
                            onClick={handleInstallGithub}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition"
                          >
                            Connect App
                          </button>
                        )}
                      </div>

                      {isGithubConnected && (
                        <div className="bg-black/50 p-4 rounded-lg border border-slate-700 flex flex-col gap-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-400">
                              Installation ID
                            </span>
                            <span className="font-mono text-white text-xs bg-slate-800 px-2 py-1 rounded border border-slate-600">
                              {installationId || "Loading..."}
                            </span>
                          </div>
                          <button
                            onClick={handleInstallGithub}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm transition flex items-center justify-center gap-2 border border-slate-600"
                          >
                            <ExternalLink className="w-4 h-4" /> Manage
                            Repositories (GitHub)
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => setActiveStep(2)}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                      >
                        Continue to Step 2
                      </button>
                    </div>
                  </div>
                )}

                {/* --- STEP 2: SALESFORCE --- */}
                {activeStep === 2 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-2xl font-bold flex items-center gap-3">
                        <Cloud className="w-7 h-7 text-blue-400" /> Connect
                        Salesforce
                      </h2>
                      <button
                        onClick={() => {
                          checkSalesforceConnection();
                          checkIngestionTrust();
                          checkRecordContext();
                        }}
                        disabled={
                          checkingSalesforce ||
                          checkingIngestionTrust ||
                          checkingRecordContext
                        }
                        className="text-xs flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${checkingSalesforce || checkingIngestionTrust || checkingRecordContext ? "animate-spin" : ""}`}
                        />{" "}
                        Refresh Status
                      </button>
                    </div>
                    <p className="text-slate-400 mb-6">
                      Authenticate the Salesforce environment where tests will
                      be executed. Connect multiple roles to test different
                      permissions.
                    </p>

                    {/* 👇 MULTI-ROLE CARDS 👇 */}
                    <div className="space-y-4 mb-6">
                      {[
                        {
                          id: "admin",
                          title: "System Admin (Default)",
                          desc: "Required for reading Metadata & Executing Tests",
                        },
                        {
                          id: "sales_rep",
                          title: "Sales Rep",
                          desc: "Standard user for executing sales workflows",
                        },
                        {
                          id: "manager",
                          title: "Manager / Approver",
                          desc: "Required for testing approval processes",
                        },
                      ].map((role) => {
                        const conn = salesforceConnections.find(
                          (c) => c.actorRole === role.id,
                        );
                        const isExpired = Boolean(
                          conn && conn.status === "EXPIRED",
                        );
                        return (
                          <div
                            key={role.id}
                            className="bg-slate-950 border border-slate-700 rounded-xl p-5"
                          >
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                              <div>
                                <h3 className="font-semibold text-white">
                                  {role.title}
                                </h3>
                                {conn ? (
                                  <p
                                    className={`text-xs mt-1 ${isExpired ? "text-amber-300" : "text-green-400"}`}
                                  >
                                    {isExpired
                                      ? `Action Required: Reconnect ${role.title}`
                                      : `Connected: ${conn.sf_username}`}
                                  </p>
                                ) : (
                                  <p className="text-xs text-slate-400 mt-1">
                                    {role.desc}
                                  </p>
                                )}
                              </div>
                              {checkingSalesforce ? (
                                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                              ) : conn ? (
                                <div className="flex gap-2">
                                  {isExpired && (
                                    <button
                                      onClick={() =>
                                        handleConnectSalesforce(
                                          role.id,
                                          resolveSalesforceEnvironment(conn),
                                        )
                                      }
                                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition whitespace-nowrap"
                                    >
                                      Reconnect
                                    </button>
                                  )}
                                  <button
                                    onClick={() =>
                                      handleDisconnectSalesforce(role.id)
                                    }
                                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-red-400 rounded-lg text-sm font-medium transition border border-slate-700 whitespace-nowrap"
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() =>
                                      handleConnectSalesforce(
                                        role.id,
                                        "production",
                                      )
                                    }
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition whitespace-nowrap"
                                  >
                                    Connect Prod
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleConnectSalesforce(
                                        role.id,
                                        "sandbox",
                                      )
                                    }
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 rounded-lg text-sm font-medium transition whitespace-nowrap"
                                  >
                                    Connect Sandbox
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isSfAdminConnected && (
                      <div className="mb-6 rounded-xl border border-slate-700 bg-slate-950 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
                              Ingestion Trust Manifest
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-white">
                              {ingestionTrustReadError && !ingestionTrust
                                ? "Ingestion status temporarily unavailable"
                                : ingestionTrust?.latestRun
                                  ? `${ingestionTrust.latestRun.status} · ${ingestionTrust.latestRun.status === "SUCCEEDED" && ingestionTrust.strictCoverage?.strictComplete ? "strict coverage verified" : ingestionTrust.latestRun.status === "RUNNING" ? "coverage verification pending" : "coverage gaps remain"}`
                                : "No evidenced ingestion run yet"}
                            </h3>
                            {ingestionTrustReadError && ingestionTrust && (
                              <p className="mt-1 text-xs text-amber-300">
                                Status read unavailable. Showing last verified snapshot
                                {ingestionTrustObservedAt
                                  ? ` from ${ingestionTrustObservedAt.toLocaleTimeString()}`
                                  : ""}
                                ; current coverage is unverified.
                              </p>
                            )}
                            <p className="mt-1 max-w-xl text-xs text-slate-400">
                              Coverage is measured separately for capture,
                              projection, reconciliation, live read, temporal
                              history, authorization, and freshness. Restricted
                              and binary sources are accounted for, not claimed
                              as indexed.
                            </p>
                          </div>
                          <button
                            onClick={handleRetryIngestion}
                            disabled={
                              retryingIngestion ||
                              ingestionTrust?.latestRun?.status === "RUNNING"
                            }
                            className="flex items-center gap-2 rounded-lg border border-cyan-700 bg-cyan-950/50 px-3 py-2 text-xs font-medium text-cyan-200 disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${retryingIngestion ? "animate-spin" : ""}`}
                            />
                            Retry failed work
                          </button>
                        </div>

                        {ingestionTrust?.latestRun && (
                          <>
                            {ingestionTrust.strictCoverage ? (
                              <div className="mt-5 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                                <p className="text-xs text-slate-300">
                                  Ledger accounted: {ingestionTrust.strictCoverage.accounted.toLocaleString()} / {ingestionTrust.strictCoverage.total.toLocaleString()}
                                  {ingestionTrust.strictCoverage.unaccounted > 0
                                    ? ` · ${ingestionTrust.strictCoverage.unaccounted.toLocaleString()} unaccounted`
                                    : ""}
                                </p>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                                  {Object.entries(ingestionTrust.strictCoverage.dimensions).map(
                                    ([name, dimension]) => (
                                      <div key={name} className="rounded border border-slate-700 px-2 py-1.5">
                                        <p className="text-slate-400">
                                          {name.replace(/([A-Z])/g, " $1").toLowerCase()}
                                        </p>
                                        <p className="font-semibold text-slate-100">
                                          {dimension.percent}%
                                        </p>
                                        {(dimension.partial + dimension.failed + dimension.pending) > 0 && (
                                          <p className="text-amber-300">
                                            {dimension.partial} partial · {dimension.failed} failed · {dimension.pending} pending
                                          </p>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="mt-4 text-xs text-amber-300">
                                Strict coverage evidence is unavailable; the run is not verified complete.
                              </p>
                            )}
                            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                              {[
                                [
                                  "Schema",
                                  `${ingestionTrust.latestRun.coverageSummary?.schema.percent ?? 0}%`,
                                ],
                                [
                                  "Metadata",
                                  `${ingestionTrust.latestRun.coverageSummary?.metadata.percent ?? 0}%`,
                                ],
                                [
                                  "Freshness",
                                  ingestionTrust.freshness.ageHours === null
                                    ? "Unknown"
                                    : `${ingestionTrust.freshness.ageHours}h ago`,
                                ],
                                [
                                  "API budget",
                                  ingestionTrust.latestRun.apiBudget
                                    ?.usedPercent == null
                                    ? "Unavailable"
                                    : `${ingestionTrust.latestRun.apiBudget.usedPercent}% used`,
                                ],
                              ].map(([label, value]) => (
                                <div
                                  key={label}
                                  className="rounded-lg border border-slate-800 bg-slate-900 p-3"
                                >
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                                    {label}
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-100">
                                    {value}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {(ingestionTrust.latestRun.coverageSummary?.schema
                              .systemRestricted ?? 0) > 0 && (
                              <div className="mt-4 rounded-lg border border-sky-700/50 bg-sky-950/30 p-3">
                                <p className="text-xs font-semibold text-sky-300">
                                  System restricted / inaccessible
                                </p>
                                <p className="mt-1 text-xs text-sky-100/70">
                                  Salesforce exposed{" "}
                                  {ingestionTrust.latestRun.coverageSummary
                                    ?.schema.globallyVisible ?? 0}{" "}
                                  objects globally, but denied describe access
                                  to{" "}
                                  {ingestionTrust.latestRun.coverageSummary
                                    ?.schema.systemRestricted ?? 0}
                                  . These are excluded from the accessible
                                  coverage denominator and retained as audit
                                  evidence.
                                </p>
                              </div>
                            )}
                            {(ingestionTrust.latestRun.failureSummary?.length ||
                              0) > 0 && (
                              <div className="mt-4 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3">
                                <p className="text-xs font-semibold text-amber-300">
                                  Retryable gaps
                                </p>
                                {ingestionTrust.latestRun.failureSummary?.map(
                                  (failure, index) => (
                                    <p
                                      key={`${failure.stage}-${index}`}
                                      className="mt-1 text-xs text-amber-100/70"
                                    >
                                      {failure.stage}: {failure.message}
                                    </p>
                                  ),
                                )}
                              </div>
                            )}
                            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`rounded-full px-2 py-1 ${ingestionTrust.latestBenchmark?.corpusSummary?.valid ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-800 text-slate-400"}`}
                              >
                                Frozen corpus:{" "}
                                {ingestionTrust.latestBenchmark?.corpusSummary
                                  ?.valid
                                  ? "validated"
                                  : "not recorded"}
                              </span>
                              <span
                                className={`rounded-full px-2 py-1 ${ingestionTrust.benchmarkReadyChecks.observedRuntimeBenchmarkPassed ? "bg-emerald-900/50 text-emerald-300" : "bg-amber-950/50 text-amber-300"}`}
                              >
                                Live benchmark:{" "}
                                {ingestionTrust.benchmarkReadyChecks
                                  .observedRuntimeBenchmarkPassed
                                  ? "passed"
                                  : "evidence required"}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {isSfAdminConnected && (
                      <div className="mb-6 rounded-xl border border-emerald-800/70 bg-slate-950 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">
                              <Database className="h-4 w-4" /> Live Record
                              Context
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-white">
                              {recordContextReadError && !recordContext
                                ? "Record context status temporarily unavailable"
                                : recordContext
                                ? `${recordContext.status} · ${recordContext.objects.percentComplete}% authorized objects accounted for`
                                : "No record baseline has been evidenced yet"}
                            </h3>
                            {(recordContextReadError ||
                              recordContext?.statusReadStatus === "stale") &&
                              recordContext && (
                              <p className="mt-1 text-xs text-amber-300">
                                Status read unavailable. Showing last verified snapshot
                                {recordContext.snapshotAsOf
                                  ? ` from ${new Date(recordContext.snapshotAsOf).toLocaleTimeString()}`
                                  : recordContextObservedAt
                                    ? ` from ${recordContextObservedAt.toLocaleTimeString()}`
                                  : ""}
                                ; current record freshness is unverified.
                              </p>
                            )}
                            <p className="mt-1 max-w-2xl text-xs text-slate-400">
                              Current values are materialized from an authorized
                              baseline, kept fresh by Salesforce Change Data
                              Capture, and periodically reconciled. Restricted
                              objects remain explicit coverage outcomes.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleRecordContextSync(false)}
                              disabled={
                                syncingRecordContext ||
                                recordContext?.status === "RUNNING"
                              }
                              className="flex items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${syncingRecordContext ? "animate-spin" : ""}`}
                              />
                              Resume incremental sync
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Run a full Salesforce record reconciliation? This may consume substantial API budget.",
                                  )
                                ) {
                                  void handleRecordContextSync(true);
                                }
                              }}
                              disabled={
                                reconcilingRecordContext ||
                                recordContext?.status === "RUNNING"
                              }
                              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
                            >
                              <Database
                                className={`h-3.5 w-3.5 ${reconcilingRecordContext ? "animate-pulse" : ""}`}
                              />
                              Full reconciliation
                            </button>
                          </div>
                        </div>

                        {recordContext && (
                          <>
                            <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
                                style={{
                                  width: `${Math.min(100, Math.max(0, recordContext.objects.percentComplete))}%`,
                                }}
                              />
                            </div>
                            <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                              <span>
                                {recordContext.objects.completed} complete ·{" "}
                                {recordContext.objects.inaccessible}{" "}
                                inaccessible · {recordContext.objects.running}{" "}
                                running · {recordContext.objects.pending ?? 0}{" "}
                                pending · {recordContext.objects.failed} failed
                              </span>
                              <span>
                                {Math.max(
                                  0,
                                  100 - recordContext.objects.percentComplete,
                                ).toFixed(2)}
                                % remaining
                              </span>
                            </div>

                            {(recordContext.objects.running > 0 ||
                              (recordContext.objects.pending ?? 0) > 0) && (
                              <div className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
                                <p className="text-xs font-semibold text-amber-200">
                                  Unfinished object checkpoints
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {recordContext.checkpoints
                                    .filter((checkpoint) =>
                                      ["RUNNING", "PENDING"].includes(
                                        checkpoint.status,
                                      ),
                                    )
                                    .slice(0, 8)
                                    .map((checkpoint) => (
                                      <span
                                        key={checkpoint.objectType}
                                        className="rounded border border-amber-800/50 px-2 py-1 text-[11px] text-amber-100"
                                      >
                                        {checkpoint.objectType} · {checkpoint.status.toLowerCase()}
                                      </span>
                                    ))}
                                  {recordContext.objects.running +
                                    (recordContext.objects.pending ?? 0) >
                                    8 && (
                                    <span className="text-[11px] text-amber-200/70">
                                      +
                                      {recordContext.objects.running +
                                        (recordContext.objects.pending ?? 0) -
                                        8} more
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                              {[
                                [
                                  "Current records",
                                  recordContext.records.current.toLocaleString(),
                                ],
                                [
                                  "Record links",
                                  recordContext.records.relationships.toLocaleString(),
                                ],
                                [
                                  "Deleted tombstones",
                                  recordContext.records.deleted.toLocaleString(),
                                ],
                                [
                                  "Stale records",
                                  recordContext.records.stale.toLocaleString(),
                                ],
                              ].map(([label, value]) => (
                                <div
                                  key={label}
                                  className="rounded-lg border border-slate-800 bg-slate-900 p-3"
                                >
                                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                                    {label}
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-100">
                                    {value}
                                  </p>
                                </div>
                              ))}
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
                              <RadioTower className="h-4 w-4 text-cyan-400" />
                              <span className="text-slate-200">
                                {recordContext.realtime.subscribedChannels} live
                                CDC channels
                              </span>
                              <span className="text-slate-500">
                                {recordContext.realtime.inaccessibleChannels}{" "}
                                inaccessible
                              </span>
                              <span
                                className={
                                  recordContext.realtime.errorChannels > 0
                                    ? "text-rose-300"
                                    : "text-slate-500"
                                }
                              >
                                {recordContext.realtime.errorChannels} errors
                              </span>
                              <span className="ml-auto text-slate-500">
                                Last event:{" "}
                                {recordContext.realtime.lastEventAt
                                  ? new Date(
                                      recordContext.realtime.lastEventAt,
                                    ).toLocaleString()
                                  : "Not observed"}
                              </span>
                            </div>

                            {recordContext.objects.failed > 0 && (
                              <div className="mt-4 rounded-lg border border-rose-800/60 bg-rose-950/20 p-3">
                                <p className="text-xs font-semibold text-rose-300">
                                  Objects requiring attention
                                </p>
                                <p className="mt-1 text-xs text-rose-100/70">
                                  {recordContext.checkpoints
                                    .filter(
                                      (checkpoint) =>
                                        checkpoint.status === "FAILED",
                                    )
                                    .slice(0, 8)
                                    .map((checkpoint) => checkpoint.objectType)
                                    .join(", ")}
                                </p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Important Action Required Block - Only shows if Admin is connected */}
                    {isSfAdminConnected && (
                      <div className="p-5 border border-yellow-700/50 bg-yellow-900/20 rounded-xl relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500"></div>
                        <h4 className="text-yellow-400 font-semibold flex items-center gap-2 mb-2">
                          <AlertCircle className="w-5 h-5" /> Important Action
                          Required
                        </h4>
                        <p className="text-sm text-yellow-100/80 mb-4">
                          Ensure your GitHub Actions workflow is authenticated
                          with Salesforce. Generate your SFDX Auth URL locally
                          and add it to your GitHub Repository Secrets.
                        </p>

                        <div className="bg-black/50 p-3 rounded border border-slate-700 font-mono text-xs space-y-3">
                          <div>
                            <p className="text-amber-100/80 mb-1 font-sans text-xs font-medium">
                              login to salesforce account through this command
                            </p>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-300">
                                sf org login web --alias staging-org
                              </span>
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    "sf org login web --alias staging-org",
                                    (value) => {
                                      if (value)
                                        setCopiedSfdxCommand(
                                          "sf org login web --alias staging-org",
                                        );
                                      setTimeout(
                                        () => setCopiedSfdxCommand(null),
                                        3000,
                                      );
                                    },
                                  )
                                }
                                className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                                aria-label="Copy Salesforce login command"
                              >
                                {copiedSfdxCommand ===
                                "sf org login web --alias staging-org" ? (
                                  <CheckCircle className="w-4 h-4 text-green-400" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="text-amber-100/80 mb-1 font-sans text-xs font-medium">
                              then run this command for sfdx auth url{" "}
                            </p>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-300">
                                sf org display --target-org staging-org
                                --verbose
                              </span>
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    "sf org display --target-org staging-org --verbose",
                                    (value) => {
                                      if (value)
                                        setCopiedSfdxCommand(
                                          "sf org display --target-org staging-org --verbose",
                                        );
                                      setTimeout(
                                        () => setCopiedSfdxCommand(null),
                                        3000,
                                      );
                                    },
                                  )
                                }
                                className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                                aria-label="Copy SFDX auth URL command"
                              >
                                {copiedSfdxCommand ===
                                "sf org display --target-org staging-org --verbose" ? (
                                  <CheckCircle className="w-4 h-4 text-green-400" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          Save the resulting URL as{" "}
                          <strong className="text-white">SFDX_AUTH_URL</strong>{" "}
                          in your GitHub Secrets.
                        </p>
                      </div>
                    )}

                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => setActiveStep(3)}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
                      >
                        Continue to Step 3
                      </button>
                    </div>
                  </div>
                )}

                {/* --- STEP 3: API KEYS --- */}
                {activeStep === 3 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
                      <KeyRound className="w-7 h-7 text-emerald-400" /> Generate
                      API Key
                    </h2>
                    <p className="text-gray-400 mb-6">
                      Create a revokable key to allow your CI/CD pipeline to
                      securely trigger Jataka AI tests.
                    </p>

                    {/* Generate Key Form */}
                    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-6">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Pipeline Name
                      </label>
                      <div className="flex gap-3">
                        <input
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                          placeholder="e.g. Copado Staging Pipeline"
                        />
                        <button
                          onClick={handleCreateKey}
                          disabled={creatingKey}
                          className="px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center gap-2"
                        >
                          {creatingKey ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <KeyRound className="w-4 h-4" />
                          )}{" "}
                          Generate
                        </button>
                      </div>
                    </div>

                    {/* Show newly generated key exactly once */}
                    {generatedKey && (
                      <div className="p-5 border border-emerald-500/50 bg-emerald-900/20 rounded-xl mb-6 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                        <div className="flex items-start gap-3 mb-3">
                          <ShieldAlert className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-emerald-400 text-lg">
                              Copy this key immediately!
                            </p>
                            <p className="text-sm text-emerald-200/70 mt-1">
                              Go to your GitHub Repository → Settings → Secrets
                              and Variables → Actions. Create a new secret named{" "}
                              <strong className="text-white bg-black/30 px-1 py-0.5 rounded">
                                JATAKA_API_KEY
                              </strong>{" "}
                              and paste this value.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-black/60 border border-emerald-500/30 rounded-lg p-3">
                          <code className="text-sm text-emerald-300 break-all flex-1 font-mono">
                            {generatedKey}
                          </code>
                          <button
                            onClick={() =>
                              copyToClipboard(generatedKey, setCopiedKey)
                            }
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-md flex items-center gap-2 transition"
                          >
                            {copiedKey ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                            {copiedKey ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            setGeneratedKey(null);
                            setActiveStep(4);
                          }}
                          className="w-full mt-4 py-2 text-emerald-400 hover:bg-emerald-900/40 rounded-lg text-sm font-medium transition"
                        >
                          I have saved it in GitHub Secrets →
                        </button>
                      </div>
                    )}

                    {/* Existing Keys */}
                    <div className="mt-8">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                        Active Pipeline Keys
                      </h3>
                      {keysLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                      ) : keys.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          No keys generated yet.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {keys.map((key) => (
                            <div
                              key={key.id}
                              className="flex items-center justify-between p-4 bg-gray-900/50 border border-gray-800 rounded-lg hover:border-gray-700 transition"
                            >
                              <div>
                                <p className="font-medium text-white">
                                  {key.name}
                                </p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                  <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                                    {key.keyPreview}
                                  </code>
                                  <span>•</span>
                                  <span>
                                    Used{" "}
                                    {key.lastUsedAt
                                      ? new Date(
                                          key.lastUsedAt,
                                        ).toLocaleDateString()
                                      : "Never"}
                                  </span>
                                  {!key.isActive && (
                                    <span className="text-red-400 font-medium">
                                      • Revoked
                                    </span>
                                  )}
                                </div>
                              </div>
                              {key.isActive && (
                                <button
                                  onClick={() => handleRevokeKey(key.id)}
                                  className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* --- STEP 4: YAML INJECTION --- */}
                {activeStep === 4 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
                      <TerminalSquare className="w-7 h-7 text-indigo-400" />{" "}
                      Configure CI/CD
                    </h2>
                    <p className="text-gray-400 mb-6">
                      Paste this step into your GitHub Actions{" "}
                      <code className="bg-gray-900 px-1.5 py-0.5 rounded text-gray-300">
                        .yml
                      </code>{" "}
                      workflow file. We recommend placing this directly after
                      your deployment step.
                    </p>

                    <div className="bg-[#0d1117] rounded-xl border border-gray-700 overflow-hidden shadow-2xl">
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                        <span className="text-xs text-gray-400 font-mono">
                          .github/workflows/deploy.yml
                        </span>
                        <button
                          onClick={() =>
                            copyToClipboard(yamlSnippet, setCopiedYaml)
                          }
                          className="flex items-center gap-2 text-xs font-medium text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition"
                        >
                          {copiedYaml ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedYaml ? "Copied" : "Copy YAML"}
                        </button>
                      </div>
                      <div className="p-4 overflow-x-auto">
                        <pre className="text-sm font-mono leading-relaxed text-gray-300">
                          <code
                            dangerouslySetInnerHTML={{
                              __html: yamlSnippet
                                .replace(
                                  installationId
                                    ? String(installationId)
                                    : '"YOUR_INSTALLATION_ID"',
                                  `<span class="text-blue-400 font-bold">${installationId || '"YOUR_INSTALLATION_ID"'}</span>`,
                                )
                                .replace(
                                  /\${{ secrets.JATAKA_API_KEY }}/g,
                                  `<span class="text-emerald-400">\${{ secrets.JATAKA_API_KEY }}</span>`,
                                ),
                            }}
                          />
                        </pre>
                      </div>
                    </div>

                    <div className="mt-5 p-4 bg-sky-900/20 border border-sky-700/50 rounded-xl">
                      <h4 className="font-semibold text-sky-200 mb-1.5">
                        Required GitHub variable
                      </h4>
                      <p className="text-sm text-sky-100/90 mb-3">
                        Add{" "}
                        <code className="bg-black/40 px-1 rounded">
                          JATAKA_TEST_MODE
                        </code>{" "}
                        in your GitHub Actions variables.
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-sky-700/50">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-sky-900/40 text-sky-200">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Value</th>
                              <th className="px-3 py-2 font-semibold">Runs</th>
                            </tr>
                          </thead>
                          <tbody className="text-sky-100/90">
                            <tr className="border-t border-sky-700/40">
                              <td className="px-3 py-2 font-mono">ui</td>
                              <td className="px-3 py-2">UI-only tests</td>
                            </tr>
                            <tr className="border-t border-sky-700/40">
                              <td className="px-3 py-2 font-mono">backend</td>
                              <td className="px-3 py-2">Backend-only tests</td>
                            </tr>
                            <tr className="border-t border-sky-700/40">
                              <td className="px-3 py-2 font-mono">hybrid</td>
                              <td className="px-3 py-2">
                                Both UI and backend tests
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {!installationId && (
                      <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg flex gap-2">
                        <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                        <p className="text-sm text-yellow-200">
                          Your GitHub integration isn&apos;t fully set up yet.
                          Go back to <strong>Step 1</strong> to connect GitHub,
                          and this snippet will automatically update with your
                          actual{" "}
                          <code className="bg-black/40 px-1 rounded">
                            installation_id
                          </code>
                          .
                        </p>
                      </div>
                    )}

                    <div className="mt-8 p-4 bg-indigo-900/20 border border-indigo-700/50 rounded-xl">
                      <h4 className="font-semibold text-indigo-300 mb-2">
                        Why this approach?
                      </h4>
                      <p className="text-sm text-indigo-100/70">
                        We prioritize your security. By using a webhook curl,
                        you maintain 100% control over your pipeline. We do not
                        inject hidden code or force PRs into your repository. We
                        simply receive the signal, run our AI tests, and post
                        the results back to your PR status checks.
                      </p>
                    </div>

                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => setActiveStep(5)}
                        className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
                      >
                        Continue to Optional Settings
                      </button>
                    </div>
                  </div>
                )}

                {/* --- STEP 5: OPTIONAL / JIRA / SYNC --- */}
                {activeStep === 5 && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                    <div>
                      <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
                        <RefreshCw className="w-7 h-7 text-gray-400" /> Optional
                        Integrations
                      </h2>
                      <p className="text-gray-400">
                        Advanced settings for issue tracking and deep repository
                        sync.
                      </p>
                    </div>

                    {/* Jira Card */}
                    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                      <div className="flex justify-between items-center mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            Jira Ticketing
                          </h3>
                          <p className="text-sm text-gray-400">
                            Automatically create tickets when tests fail
                          </p>
                        </div>
                        {checkingJira ? (
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        ) : jiraConnected ? (
                          <button
                            onClick={handleDisconnectJira}
                            className="text-xs text-red-400 hover:text-red-300 bg-red-400/10 px-3 py-1.5 rounded-full transition"
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            onClick={handleConnectJira}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition"
                          >
                            Connect Jira
                          </button>
                        )}
                      </div>
                      {jiraConnected && jiraInfo && (
                        <div className="bg-gray-800 rounded-lg p-4 text-sm mt-4 grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-gray-500 block">
                              Site URL
                            </span>{" "}
                            {jiraInfo.site_url}
                          </div>
                          <div>
                            <span className="text-gray-500 block mb-1">
                              Project Key
                            </span>
                            {editingProjectKey ? (
                              <div className="flex gap-2">
                                <input
                                  value={newProjectKey}
                                  onChange={(e) =>
                                    setNewProjectKey(
                                      e.target.value.toUpperCase(),
                                    )
                                  }
                                  className="w-20 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white"
                                />
                                <button
                                  onClick={handleUpdateJiraKey}
                                  disabled={updatingJira}
                                  className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                >
                                  {updatingJira ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    "Save"
                                  )}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-mono bg-gray-900 px-2 py-0.5 rounded text-blue-300">
                                  {jiraInfo.project_key || "Not Set"}
                                </span>
                                <button
                                  onClick={() => setEditingProjectKey(true)}
                                  className="text-xs text-gray-500 hover:text-white"
                                >
                                  Edit
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Deep Sync Card */}
                    {isSfAdminConnected && (
                      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">
                          Org Intelligence Sync
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-blue-500/30 transition-colors">
                            <h4 className="font-medium text-white mb-1">
                              Standard Schema
                            </h4>
                            <p className="text-xs text-gray-400 mb-4 h-8">
                              Syncs Objects, Fields, and Types so the AI knows
                              your forms.
                            </p>
                            <button
                              onClick={handleSyncSchemaData}
                              disabled={isSyncingSchema}
                              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isSyncingSchema ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : null}{" "}
                              Sync Schema
                            </button>
                          </div>
                          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-blue-500/30 transition-colors">
                            <h4 className="font-medium text-white mb-1">
                              Impact Graph
                            </h4>
                            <p className="text-xs text-gray-400 mb-4 h-8">
                              Syncs Component Dependencies for deep regression
                              routing.
                            </p>
                            <button
                              onClick={handleSyncDependenciesData}
                              disabled={isSyncingDependencies}
                              className="w-full py-2 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-800 text-blue-300 rounded text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isSyncingDependencies ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : null}{" "}
                              Sync Graph
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {progressPercentage === 100 && (
                      <div className="mt-8 p-6 bg-gradient-to-r from-emerald-900/40 to-blue-900/40 border border-emerald-500/30 rounded-xl text-center">
                        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                          <CheckCircle className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">
                          You&apos;re All Set!
                        </h3>
                        <p className="text-gray-400 text-sm">
                          Your pipeline is fully configured. Open a PR in your
                          repository to see Jataka AI in action.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
