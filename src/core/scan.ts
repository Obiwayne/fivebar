import fs from "node:fs";
import path from "node:path";
import { ignoredDirs } from "./git.js";
import { openCounts, score, toFindings } from "./merge.js";
import { RUNNERS, type RunResult } from "./runners.js";
import { Store } from "./store.js";
import { TOOLS, toolStatus } from "./tools.js";
import type { Finding, Project, ScanRecord, ScanTrigger, ToolName, ToolRun } from "./types.js";

export interface ScanOptions {
  mode: "full" | "changed";
  files?: string[];
  trigger: ScanTrigger;
  /** Commit ranges being pushed. Gitleaks checks every commit in them. */
  commitRanges?: string[];
}

export interface ScanOutcome {
  scan: ScanRecord;
  open: Finding[];
  newFindings: Finding[];
  closed: Finding[];
  /** Open findings in the files this scan looked at. */
  inScope: Finding[];
  /** Open findings a tool reported in this scan, including secrets found in pushed commits. */
  reported: Finding[];
}

export class ToolsMissingError extends Error {
  constructor(public missing: string[]) {
    super(`These scanners are not installed yet: ${missing.join(", ")}. Run "fivebar tools install".`);
  }
}

function inScope(f: Finding, opts: ScanOptions, runs: Map<ToolName, ToolRun>): boolean {
  if (opts.mode === "full") return true;
  if (f.kind === "dependency") return !!runs.get("osv-scanner") && !runs.get("osv-scanner")!.skipped;
  return !!opts.files?.includes(f.file);
}

export async function scanProject(store: Store, project: Project, opts: ScanOptions): Promise<ScanOutcome> {
  const missing = toolStatus().filter((t) => !t.installed).map((t) => t.label);
  if (missing.length) throw new ToolsMissingError(missing);

  const startedAt = new Date().toISOString();
  const runOpts = {
    root: project.path,
    files: opts.mode === "changed" ? opts.files ?? [] : undefined,
    skipPaths: [...project.settings.skipPaths, ...(await ignoredDirs(project.path))],
    commitRanges: opts.commitRanges,
  };
  const results: RunResult[] = await Promise.all(
    TOOLS.map((t) =>
      RUNNERS[t.name](runOpts).catch((e: Error) => ({
        run: { tool: t.name, ok: false, durationMs: 0, count: 0, error: e.message },
        candidates: [],
      })),
    ),
  );
  const runs = new Map(results.map((r) => [r.run.tool, r.run]));
  const now = new Date().toISOString();
  const fresh = toFindings(project.id, project.path, results.flatMap((r) => r.candidates), now);

  const outcome = await store.run(true, (db) => {
    const stmt = db.prepare("SELECT data FROM findings WHERE project_id = ?");
    stmt.bind([project.id]);
    const existing = new Map<string, Finding>();
    while (stmt.step()) {
      const f = JSON.parse(String(stmt.getAsObject().data)) as Finding;
      existing.set(f.id, f);
    }
    stmt.free();

    const newFindings: Finding[] = [];
    let reopenedCount = 0;
    const seen = new Set<string>();
    for (const f of fresh) {
      seen.add(f.id);
      const old = existing.get(f.id);
      if (!old) {
        newFindings.push(f);
        existing.set(f.id, f);
        Store.putFinding(db, f);
        continue;
      }
      const reopened = old.status === "fixed";
      const merged: Finding = {
        ...old,
        title: f.title,
        severity: f.severity,
        startLine: f.startLine,
        endLine: f.endLine,
        snippet: f.snippet,
        fix: f.fix,
        tools: f.tools,
        lastSeen: now,
        status: reopened ? "open" : old.status,
        fixedAt: reopened ? undefined : old.fixedAt,
      };
      if (reopened) {
        newFindings.push(merged);
        reopenedCount++;
      }
      existing.set(f.id, merged);
      Store.putFinding(db, merged);
    }

    const closed: Finding[] = [];
    for (const f of existing.values()) {
      // Accepted risks come back for review when they expire.
      if (f.status === "accepted" && f.expiresAt && f.expiresAt < now) {
        f.status = "open";
        Store.putFinding(db, f);
        Store.insertEvent(db, project.id, "risk-expired", `Accepted risk expired: ${f.title}`, { id: f.id });
      }
      if (f.status !== "open" || seen.has(f.id) || !inScope(f, opts, runs)) continue;
      // Only close a finding when every tool that reported it ran cleanly this time.
      const toolsRan = f.tools.every((t) => runs.get(t.tool)?.ok && !runs.get(t.tool)?.skipped);
      if (!toolsRan) continue;
      f.status = "fixed";
      f.fixedAt = now;
      closed.push(f);
      Store.putFinding(db, f);
    }

    const all = [...existing.values()];
    const scanData: Omit<ScanRecord, "id"> = {
      projectId: project.id,
      trigger: opts.trigger,
      mode: opts.mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      files: opts.mode === "changed" ? opts.files?.length ?? 0 : -1,
      tools: results.map((r) => r.run),
      newIds: newFindings.map((f) => f.id),
      closedIds: closed.map((f) => f.id),
      openCounts: openCounts(all),
      score: score(all),
    };
    const id = Store.insertScan(db, scanData);
    const label = opts.mode === "full" ? "Full scan" : `Scan of ${scanData.files} changed file${scanData.files === 1 ? "" : "s"}`;
    Store.insertEvent(db, project.id, "scan", `${label}: ${newFindings.length - reopenedCount} new, ${reopenedCount ? `${reopenedCount} back again, ` : ""}${closed.length} closed`, { scanId: id, trigger: opts.trigger, score: scanData.score });
    const open = all.filter((f) => f.status === "open");
    return {
      scan: { ...scanData, id },
      open,
      newFindings,
      closed,
      inScope: open.filter((f) => inScope(f, opts, runs)),
      reported: open.filter((f) => seen.has(f.id)),
    };
  });

  if (project.connection.findingsFile) writeFindingsFile(project, outcome.open);
  return outcome;
}

/** A plain Markdown list for agents that support neither MCP nor hooks (Codex, Cursor and others). */
export function writeFindingsFile(project: Project, open: Finding[]) {
  const dir = path.join(project.path, ".fivebar");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    "# Fivebar findings",
    "",
    `Updated ${new Date().toISOString()}. Fix these, then run your tests. Fivebar re-checks on the next scan.`,
    "",
  ];
  if (!open.length) lines.push("No open findings.");
  for (const f of [...open].sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(`## ${f.severity.toUpperCase()}: ${f.title}`, "");
    lines.push(`- Where: \`${f.file}${f.startLine ? `:${f.startLine}` : ""}\``);
    if (f.cwe) lines.push(`- Type: ${f.cwe}`);
    lines.push(`- Found by: ${f.tools.map((t) => t.tool).join(", ")}`);
    if (f.fix) lines.push(`- Fix: ${f.fix}`);
    lines.push("");
  }
  fs.writeFileSync(path.join(dir, "findings.md"), lines.join("\n"));
}
