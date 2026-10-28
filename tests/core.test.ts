import { describe, expect, it } from "vitest";
import { groupCandidates, score, toFindings } from "../src/core/merge";
import { globToRegex, isSkipped, redact } from "../src/core/runners";
import { formatForAgent } from "../src/core/hooks";
import type { Candidate, Finding } from "../src/core/types";

const base: Candidate = {
  tool: "opengrep",
  ruleId: "fivebar.js.sql-template-literal",
  kind: "code",
  title: "SQL is built from a template string",
  message: "SQL is built from a template string.",
  severity: "high",
  file: "src/db.ts",
  startLine: 10,
  endLine: 10,
  category: "sql-injection",
  cwe: "CWE-89",
};

describe("dedupe", () => {
  it("merges two tools reporting the same problem within 3 lines", () => {
    const groups = groupCandidates([base, { ...base, tool: "gitleaks", ruleId: "other", startLine: 12, category: "x" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it("keeps problems apart when they are far apart or in different files", () => {
    expect(groupCandidates([base, { ...base, startLine: 30 }])).toHaveLength(2);
    expect(groupCandidates([base, { ...base, file: "src/other.ts" }])).toHaveLength(2);
  });

  it("treats advisory aliases as the same dependency problem", () => {
    const dep = (vulnId: string, aliases: string[]): Candidate => ({
      ...base, tool: "osv-scanner", kind: "dependency", file: "package-lock.json", startLine: 0, category: "vulnerable-dependency",
      dependency: { name: "lodash", version: "4.17.20", ecosystem: "npm", vulnId, aliases },
    });
    expect(groupCandidates([dep("GHSA-1", ["CVE-1"]), dep("CVE-1", [])])).toHaveLength(1);
  });

  it("records every tool and the highest severity on the merged finding", () => {
    const [f] = toFindings("p", ".", [{ ...base, severity: "medium" }, { ...base, tool: "gitleaks", ruleId: "r2", severity: "critical" }], "2026-10-28T00:00:00Z");
    expect(f.severity).toBe("critical");
    expect(f.tools.map((t) => t.tool)).toEqual(["opengrep", "gitleaks"]);
  });
});

describe("score", () => {
  const f = (severity: Finding["severity"], status: Finding["status"] = "open") => ({ severity, status }) as Finding;
  it("subtracts 25/10/3/1 and floors at 0", () => {
    expect(score([])).toBe(100);
    expect(score([f("critical"), f("high"), f("medium"), f("low")])).toBe(61);
    expect(score(Array.from({ length: 5 }, () => f("critical")))).toBe(0);
  });
  it("counts accepted risks at half and ignores fixed and false positives", () => {
    expect(score([f("high", "accepted"), f("high", "fixed"), f("high", "false_positive")])).toBe(95);
  });
});

describe("skip paths", () => {
  it("matches folders at any depth and file patterns", () => {
    expect(isSkipped("node_modules/a/b.js", ["node_modules/**"])).toBe(true);
    expect(isSkipped("packages/x/node_modules/a.js", ["node_modules/**"])).toBe(true);
    expect(isSkipped("src/app.min.js", ["*.min.js"])).toBe(true);
    expect(isSkipped("src/app.js", ["node_modules/**", "*.min.js"])).toBe(false);
    expect(globToRegex("src/gen/**").test("lib/src/gen/a.ts")).toBe(false);
  });
});

describe("secrets", () => {
  it("never shows more than the last 4 characters", () => {
    expect(redact("sk_live_abcdefgh1234")).toBe("••••1234");
    expect(redact("abc")).toBe("••••");
  });
});

describe("agent message", () => {
  it("names the round, the file and line, and the fix", () => {
    const [f] = toFindings("p", ".", [{ ...base, fix: "Use a parameterised query." }], "2026-10-28T00:00:00Z");
    const msg = formatForAgent([f], 2, 3);
    expect(msg).toContain("round 2 of 3");
    expect(msg).toContain("src/db.ts:10");
    expect(msg).toContain("Use a parameterised query.");
  });
});
