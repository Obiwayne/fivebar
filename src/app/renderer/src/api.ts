// Talks to the local Fivebar server. The token is put into the page by the server,
// or read from ?token= when the UI runs from the Vite dev server.
const token =
  document.querySelector<HTMLMetaElement>('meta[name="fivebar-token"]')?.content ??
  new URLSearchParams(location.search).get("token") ??
  "dev";

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? "GET",
    headers: { "x-fivebar-token": token, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface ToolHit { tool: string; ruleId: string; message: string; severity: Severity }
export interface Finding {
  id: string; projectId: string; kind: "code" | "secret" | "dependency"; title: string; severity: Severity;
  file: string; startLine: number; endLine: number; category: string; cwe?: string; snippet?: string; fix?: string;
  dependency?: { name: string; version: string; vulnId: string; aliases: string[]; fixedIn?: string };
  tools: ToolHit[]; status: "open" | "fixed" | "false_positive" | "accepted"; reason?: string;
  firstSeen: string; lastSeen: string; fixedAt?: string; expiresAt?: string;
}
export interface ToolRun { tool: string; ok: boolean; skipped?: boolean; durationMs: number; count: number; error?: string }
export interface Scan {
  id: number; trigger: string; mode: "full" | "changed"; startedAt: string; finishedAt: string; files: number;
  tools: ToolRun[]; newIds: string[]; closedIds: string[]; openCounts: Record<Severity, number>; score: number;
}
export interface Loop {
  sessionId: string; status: "running" | "passed" | "needs_owner" | "paused";
  rounds: { at: string; findingIds: string[]; message: string }[]; startedAt: string; updatedAt: string; agent: string;
}
export interface Connection { claudeMcp: boolean; stopHook: boolean; prePush: boolean; findingsFile: boolean }
export interface ProjectSummary {
  id: string; name: string; path: string; addedAt: string;
  settings: { blockOn: Severity[]; loopOn: Severity[]; roundCap: number; skipPaths: string[] };
  connection: Connection; score: number | null; openCounts: Record<Severity, number>;
  lastScan: Scan | null; trend: { at: string; score: number }[]; loop: Loop | null;
}
export interface ProjectDetail extends ProjectSummary {
  detected: { languages: string[]; managers: string[]; testCommand?: string; git: boolean };
  events: { id: number; at: string; kind: string; text: string; data?: any }[];
  scans: Scan[]; loops: Loop[]; branch: string; head: string;
}
export interface ToolStatus { name: string; label: string; version: string; licence: string; installed: boolean }
export interface AppState {
  tools: ToolStatus[];
  settings: { setupDone?: boolean; agents?: string[] };
  projects: ProjectSummary[];
}
