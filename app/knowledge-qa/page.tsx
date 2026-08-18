"use client";

import { useAuth } from "@clerk/nextjs";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  BookOpen,
  FileCode2,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Ticket,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../components/Sidebar";
import { getApiErrorMessage } from "../lib/api-error";
import {
  type Brain,
  type EvidenceRef,
  getErrorMessage,
  resolveKnowledgeBaseId,
  statusBadgeClasses,
} from "../auto-resolution/types";

const BASE_API = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL;

type EvidenceSnapshot = {
  curriculumId?: string;
  branch?: string;
  topScore?: number;
  minScore?: number;
  retrievalIsWeak?: boolean;
  retrievalSummary?: {
    qa_resolution_matches?: number;
    vector_hits?: number;
    full_files?: number;
    graph_dependencies?: number;
    jira_context?: number;
    concepts?: number;
  };
};

type QaResponse = {
  answer: string;
  shouldEscalate: boolean;
  reason?: string;
  confidence?: number;
  topScore?: number;
  minScore?: number;
  curriculumId?: string;
  curriculumName?: string;
  evidenceRefs?: EvidenceRef[];
  evidenceSnapshot?: EvidenceSnapshot;
};

type ChatTurn =
  | { id: string; role: "user"; text: string; at: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      at: string;
      shouldEscalate?: boolean;
      reason?: string;
      confidence?: number;
      topScore?: number;
      evidenceRefs?: EvidenceRef[];
      evidenceSnapshot?: EvidenceSnapshot;
    };

const STARTERS = [
  "What does QuickAccountController.createAccount do?",
  "Why is Publish greyed out on Spanish Knowledge drafts?",
  "How do I attach a Knowledge article to a Case and email the customer?",
];

function evidenceIcon(type?: string) {
  switch (type) {
    case "file":
      return FileCode2;
    case "graph_dependency":
      return GitBranch;
    case "jira_ticket":
      return Ticket;
    case "qa_memory":
    case "concept":
    case "brum_asset":
    default:
      return BookOpen;
  }
}

export default function KnowledgeQaPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [orgName, setOrgName] = useState("Jataka");
  const [userRole, setUserRole] = useState<"ARCHITECT" | "DEVELOPER" | "">("");
  const [brains, setBrains] = useState<Brain[]>([]);
  const [activeBrain, setActiveBrain] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeKnowledgeBaseId = useMemo(
    () => resolveKnowledgeBaseId(brains, activeBrain),
    [brains, activeBrain],
  );

  async function apiFetch(path: string, options: RequestInit = {}) {
    if (!BASE_API) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
    const token = await getToken();
    const res = await fetch(`${BASE_API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        getApiErrorMessage(data, `Request failed (${res.status})`),
      );
    }
    return data;
  }

  function startFresh() {
    setTurns([]);
    setDraft("");
    setError("");
    inputRef.current?.focus();
  }

  async function submitQuestion(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    if (!activeKnowledgeBaseId) {
      setError("Select a knowledge brain before asking.");
      return;
    }

    setError("");
    setLoading(true);
    setDraft("");
    const optimisticUser: ChatTurn = {
      id: `local-user-${Date.now()}`,
      role: "user",
      text: question,
      at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimisticUser]);

    try {
      const data = (await apiFetch("/auto-resolution/qa", {
        method: "POST",
        body: JSON.stringify({
          question,
          curriculumId: activeKnowledgeBaseId,
          topK: 5,
        }),
      })) as QaResponse;

      setTurns((prev) => [
        ...prev,
        {
          id: `local-assistant-${Date.now()}`,
          role: "assistant",
          text: data.answer || "I don't have enough context to answer that.",
          at: new Date().toISOString(),
          shouldEscalate: data.shouldEscalate,
          reason: data.reason,
          confidence: data.confidence,
          topScore: data.topScore,
          evidenceRefs: data.evidenceRefs || [],
          evidenceSnapshot: data.evidenceSnapshot,
        },
      ]);
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Could not answer this question."));
      setTurns((prev) => [
        ...prev,
        {
          id: `local-err-${Date.now()}`,
          role: "assistant",
          text: "Something went wrong while querying the knowledge base. Try again in a moment.",
          at: new Date().toISOString(),
          shouldEscalate: true,
          reason: "request_failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      if (!isLoaded || !isSignedIn || !BASE_API) return;
      try {
        const sync = await apiFetch("/auth/sync");
        const orgData = sync.org || sync.organization || {};
        const rawRole = sync.user?.role || sync.orgRole || "";
        setOrgName(orgData.name || sync.orgName || sync.organizationName || "Jataka");
        setUserRole(
          rawRole === "senior" || rawRole === "org:admin" || rawRole === "admin"
            ? "ARCHITECT"
            : "DEVELOPER",
        );

        const brainsData = await apiFetch("/curriculum/list");
        const list = Array.isArray(brainsData.brains) ? brainsData.brains : [];
        setBrains(list);
        if (list.length > 0) {
          setActiveBrain(resolveKnowledgeBaseId(list, brainsData.activeBrainId));
        }
      } catch (e: unknown) {
        setError(getErrorMessage(e, "Failed to load Knowledge Q&A."));
      }
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, loading]);

  if (!isLoaded || !isSignedIn) {
    return <div className="min-h-screen bg-[var(--bg-base)]" />;
  }

  const showEmpty = turns.length === 0 && !loading;

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Sidebar orgName={orgName} userRole={userRole} />

      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(14,165,233,0.08),_transparent_45%)]"
        />

        <main className="relative z-10 flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-4 border-b border-slate-800/60 px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">Knowledge Q&A</p>
              <p className="truncate text-xs text-slate-500">
                Ask your knowledge graph · grounded answers with evidence
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startFresh}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
              >
                <MessageSquarePlus size={14} />
                New chat
              </button>
              <select
                value={activeBrain}
                onChange={(e) => setActiveBrain(e.target.value)}
                className="input select max-w-[220px] text-xs"
                title="Knowledge brain"
              >
                {brains.length === 0 ? (
                  <option value="">No brains</option>
                ) : (
                  brains.map((brain) => (
                    <option key={brain.knowledgeBaseId} value={brain.knowledgeBaseId}>
                      {brain.name || brain.knowledgeBaseId}
                    </option>
                  ))
                )}
              </select>
            </div>
          </header>

          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto w-full max-w-3xl">
              {error && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <AnimatePresence mode="wait">
                {showEmpty ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.35 }}
                    className="flex min-h-[55vh] flex-col items-center justify-center text-center"
                  >
                    <motion.div
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.08, duration: 0.4 }}
                      className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-400/25 bg-indigo-500/10"
                    >
                      <Sparkles className="text-indigo-300" size={26} />
                    </motion.div>
                    <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      Ask the knowledge base
                    </h1>
                    <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                      Get answers grounded in your Salesforce docs, graph, and past resolutions —
                      the same context Slack MCP uses.
                    </p>
                    <div className="mt-8 flex w-full max-w-xl flex-col gap-2">
                      {STARTERS.map((starter, i) => (
                        <motion.button
                          key={starter}
                          type="button"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15 + i * 0.06 }}
                          onClick={() => submitQuestion(starter)}
                          className="rounded-2xl border border-slate-800/90 bg-slate-950/40 px-4 py-3 text-left text-sm leading-6 text-slate-300 transition hover:border-slate-600 hover:bg-slate-900/60 hover:text-slate-100"
                        >
                          {starter}
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="thread"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-6 pb-8"
                  >
                    {turns.map((turn) =>
                      turn.role === "user" ? (
                        <div key={turn.id} className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600/90 px-4 py-3 text-sm leading-6 text-white shadow-lg shadow-indigo-950/30">
                            {turn.text}
                          </div>
                        </div>
                      ) : (
                        <div key={turn.id} className="flex gap-3">
                          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10">
                            <Sparkles size={14} className="text-indigo-300" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="rounded-2xl rounded-tl-md border border-slate-800/80 bg-slate-950/50 px-4 py-3 text-sm leading-7 text-slate-200 whitespace-pre-wrap">
                              {turn.text}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-1">
                              {typeof turn.confidence === "number" && (
                                <span className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300">
                                  Confidence {(turn.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                              {turn.shouldEscalate && (
                                <span
                                  className={`rounded-md border px-2 py-0.5 text-[11px] ${statusBadgeClasses("ESCALATED")}`}
                                >
                                  Low confidence / escalate
                                </span>
                              )}
                              {turn.reason && (
                                <span className="text-[11px] text-slate-500">
                                  {turn.reason.replaceAll("_", " ")}
                                </span>
                              )}
                            </div>

                            {!!turn.evidenceRefs?.length && (
                              <div className="space-y-2 pl-1">
                                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                  Evidence
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {turn.evidenceRefs.slice(0, 8).map((ref) => {
                                    const Icon = evidenceIcon(ref.type);
                                    return (
                                      <div
                                        key={`${ref.type}-${ref.id}`}
                                        className="rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2.5"
                                      >
                                        <div className="mb-1 flex items-center gap-2">
                                          <Icon size={12} className="text-indigo-300" />
                                          <p className="truncate text-xs font-medium text-slate-200">
                                            {ref.label || ref.id}
                                          </p>
                                          {typeof ref.score === "number" && (
                                            <span className="ml-auto text-[10px] text-slate-500">
                                              {(ref.score * 100).toFixed(0)}%
                                            </span>
                                          )}
                                        </div>
                                        {ref.preview && (
                                          <p className="line-clamp-3 text-[11px] leading-4 text-slate-500">
                                            {ref.preview}
                                          </p>
                                        )}
                                        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-600">
                                          {ref.type.replaceAll("_", " ")}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {turn.evidenceSnapshot?.retrievalSummary && (
                              <p className="pl-1 text-[11px] text-slate-600">
                                Retrieved{" "}
                                {turn.evidenceSnapshot.retrievalSummary.vector_hits || 0} vector hits ·{" "}
                                {turn.evidenceSnapshot.retrievalSummary.full_files || 0} files ·{" "}
                                {turn.evidenceSnapshot.retrievalSummary.graph_dependencies || 0} deps ·{" "}
                                {turn.evidenceSnapshot.retrievalSummary.qa_resolution_matches || 0} QA
                                memory
                              </p>
                            )}
                          </div>
                        </div>
                      ),
                    )}

                    {loading && (
                      <div className="flex items-center gap-3 text-sm text-slate-400">
                        <Loader2 size={16} className="animate-spin text-indigo-300" />
                        Searching your knowledge base…
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="border-t border-slate-800/60 px-4 py-4">
            <form
              className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-2 shadow-xl shadow-black/20"
              onSubmit={(e) => {
                e.preventDefault();
                submitQuestion(draft);
              }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion(draft);
                  }
                }}
                rows={1}
                placeholder="Ask about your Salesforce codebase, flows, Knowledge rules…"
                className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={loading || !draft.trim()}
                className="mb-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                title="Send"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </form>
            <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-slate-600">
              Answers come from Brum knowledge retrieval — not a support ticket. Need escalation? Use
              Ask Support.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
