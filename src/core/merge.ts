import crypto from "node:crypto";
import { readLine } from "./runners.js";
import { severityRank, type Candidate, type Finding, type Severity, type ToolHit } from "./types.js";

function hash(...parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

interface Group {
  key: string;
  members: Candidate[];
}

/**
 * Merge results from different tools that describe the same problem.
 * Code: same file and category, lines within 3 of each other.
 * Secrets: same file and the same secret value.
 * Dependencies: same package, version and advisory (aliases count as the same advisory).
 */
export function groupCandidates(cands: Candidate[]): Group[] {
  const groups: Group[] = [];
  for (const c of cands) {
    const match = groups.find((g) => {
      const h = g.members[0];
      if (h.kind !== c.kind || h.file !== c.file) return false;
      if (c.kind === "secret") return h.secretHash === c.secretHash || Math.abs(h.startLine - c.startLine) <= 0;
      if (c.kind === "dependency") {
        const a = [h.dependency!.vulnId, ...h.dependency!.aliases];
        const b = [c.dependency!.vulnId, ...c.dependency!.aliases];
        return h.dependency!.name === c.dependency!.name && h.dependency!.version === c.dependency!.version && a.some((x) => b.includes(x));
      }
      const sameCategory = h.category === c.category || (!!h.cwe && h.cwe === c.cwe);
      return sameCategory && Math.abs(h.startLine - c.startLine) <= 3;
    });
    if (match) match.members.push(c);
    else groups.push({ key: "", members: [c] });
  }
  return groups;
}

/** Stable id: survives line moves, changes when the flagged code itself changes. */
export function findingId(projectId: string, root: string, c: Candidate): string {
  if (c.kind === "secret") return hash(projectId, "secret", c.file, c.secretHash ?? String(c.startLine));
  if (c.kind === "dependency") return hash(projectId, "dep", c.dependency!.name, c.dependency!.version, c.dependency!.vulnId);
  const line = readLine(root, c.file, c.startLine).trim();
  return hash(projectId, "code", c.file, c.category, line || String(c.startLine));
}

export function toFindings(projectId: string, root: string, cands: Candidate[], now: string): Finding[] {
  return groupCandidates(cands).map((g) => {
    const lead = [...g.members].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
    const tools: ToolHit[] = [];
    for (const m of g.members) {
      if (!tools.some((t) => t.tool === m.tool && t.ruleId === m.ruleId)) {
        tools.push({ tool: m.tool, ruleId: m.ruleId, message: m.message, severity: m.severity });
      }
    }
    return {
      id: findingId(projectId, root, lead),
      projectId,
      kind: lead.kind,
      title: lead.title,
      severity: g.members.reduce<Severity>((s, m) => maxSeverity(s, m.severity), "low"),
      file: lead.file,
      startLine: lead.startLine,
      endLine: lead.endLine,
      category: lead.category,
      cwe: lead.cwe ?? g.members.find((m) => m.cwe)?.cwe,
      snippet: lead.snippet,
      fix: g.members.find((m) => m.fix && m.tool === "opengrep")?.fix ?? lead.fix,
      dependency: lead.dependency,
      tools,
      status: "open",
      firstSeen: now,
      lastSeen: now,
    } satisfies Finding;
  });
}

const WEIGHT: Record<Severity, number> = { critical: 25, high: 10, medium: 3, low: 1 };

/** 100 minus a weight per open finding. Accepted risks count half. Floor 0. */
export function score(findings: Finding[]): number {
  let s = 100;
  for (const f of findings) {
    if (f.status === "open") s -= WEIGHT[f.severity];
    else if (f.status === "accepted") s -= WEIGHT[f.severity] / 2;
  }
  return Math.max(0, Math.round(s));
}

export function openCounts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) if (f.status === "open") c[f.severity]++;
  return c;
}
