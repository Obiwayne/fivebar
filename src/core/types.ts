export type Severity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "fixed" | "false_positive" | "accepted";
export type ToolName = "opengrep" | "gitleaks" | "osv-scanner";
export type ScanTrigger = "manual" | "push" | "stop-hook" | "mcp" | "first-scan" | "nightly";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(s);
}

/** One result from one tool, before duplicates are merged. */
export interface Candidate {
  tool: ToolName;
  ruleId: string;
  kind: "code" | "secret" | "dependency";
  title: string;
  message: string;
  severity: Severity;
  file: string; // repo-relative, forward slashes
  startLine: number; // 0 when the tool gives no line
  endLine: number;
  category: string;
  cwe?: string;
  snippet?: string;
  fix?: string;
  secretHash?: string;
  dependency?: { name: string; version: string; ecosystem: string; vulnId: string; aliases: string[]; fixedIn?: string };
}

export interface ToolHit {
  tool: ToolName;
  ruleId: string;
  message: string;
  severity: Severity;
}

export interface Finding {
  id: string;
  projectId: string;
  kind: Candidate["kind"];
  title: string;
  severity: Severity;
  file: string;
  startLine: number;
  endLine: number;
  category: string;
  cwe?: string;
  snippet?: string;
  fix?: string;
  dependency?: Candidate["dependency"];
  tools: ToolHit[];
  status: FindingStatus;
  reason?: string;
  firstSeen: string;
  lastSeen: string;
  fixedAt?: string;
  expiresAt?: string;
}

export interface ToolRun {
  tool: ToolName;
  ok: boolean;
  skipped?: boolean;
  durationMs: number;
  count: number;
  error?: string;
}

export interface ScanRecord {
  id: number;
  projectId: string;
  trigger: ScanTrigger;
  mode: "full" | "changed";
  startedAt: string;
  finishedAt: string;
  files: number;
  tools: ToolRun[];
  newIds: string[];
  closedIds: string[];
  openCounts: Record<Severity, number>;
  score: number;
}

export interface ProjectConnection {
  claudeMcp: boolean;
  stopHook: boolean;
  prePush: boolean;
  findingsFile: boolean;
}

export interface ProjectSettings {
  blockOn: Severity[];
  loopOn: Severity[];
  roundCap: number;
  skipPaths: string[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  settings: ProjectSettings;
  connection: ProjectConnection;
}

export interface HistoryEvent {
  id: number;
  projectId: string;
  at: string;
  kind: string;
  text: string;
  data?: unknown;
}

export interface LoopRound {
  at: string;
  findingIds: string[];
  message: string;
}

export interface AgentLoop {
  sessionId: string;
  projectId: string;
  status: "running" | "passed" | "needs_owner" | "paused";
  rounds: LoopRound[];
  startedAt: string;
  updatedAt: string;
  agent: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  blockOn: ["critical", "high"],
  loopOn: ["critical", "high", "medium"],
  roundCap: 3,
  skipPaths: ["node_modules/**", "dist/**", "build/**", "vendor/**", ".git/**", "*.min.js"],
};
