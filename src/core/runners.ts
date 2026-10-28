import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { rulesFile, toPosix } from "./paths.js";
import { exec, toolPath } from "./tools.js";
import type { Candidate, Severity, ToolName, ToolRun } from "./types.js";

export interface RunResult {
  run: ToolRun;
  candidates: Candidate[];
}

export interface RunOptions {
  root: string;
  /** Repo-relative files to check. Undefined means the whole project. */
  files?: string[];
  skipPaths: string[];
  /** Git commit ranges to check for secrets (pre-push). Gitleaks scans every commit in them. */
  commitRanges?: string[];
}

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|requirements[^/]*\.txt|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.mod|go\.sum|Gemfile\.lock|composer\.lock|pom\.xml|gradle\.lockfile|packages\.lock\.json)$/i;

function tmpFile(name: string): string {
  return path.join(os.tmpdir(), `fivebar-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

function relPath(root: string, uri: string): string {
  let p = uri;
  if (p.startsWith("file://")) p = decodeURIComponent(p.replace(/^file:\/\/\/?/, ""));
  p = toPosix(p);
  const r = toPosix(path.resolve(root));
  if (p.toLowerCase().startsWith(r.toLowerCase() + "/")) p = p.slice(r.length + 1);
  return p.replace(/^\.\//, "");
}

/** "node_modules/**" and "*.min.js" match at any depth. "src/gen/**" matches from the project root. */
export function globToRegex(glob: string): RegExp {
  const anywhere = !glob.replace(/\/\*\*$/, "").includes("/");
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§").replace(/\*/g, "[^/]*").replace(/§/g, ".*");
  return new RegExp(`${anywhere ? "(^|/)" : "^"}${esc}${glob.endsWith("/**") ? "" : "$"}`, "i");
}

export function isSkipped(file: string, skipPaths: string[]): boolean {
  return skipPaths.some((g) => globToRegex(g).test(file));
}

function readLine(root: string, file: string, line: number): string {
  try {
    if (!line) return "";
    const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/);
    return lines[line - 1] ?? "";
  } catch {
    return "";
  }
}

// ---- Opengrep -----------------------------------------------------------------

interface RuleMeta {
  severity: Severity;
  category: string;
  cwe?: string;
  fix?: string;
}

let ruleMeta: Map<string, RuleMeta> | undefined;
function rules(): Map<string, RuleMeta> {
  if (!ruleMeta) {
    ruleMeta = new Map();
    const doc = YAML.parse(fs.readFileSync(rulesFile(), "utf8")) as { rules: any[] };
    for (const r of doc.rules) {
      const lvl = String(r.severity ?? "WARNING").toUpperCase();
      ruleMeta.set(r.id, {
        severity: (r.metadata?.["fivebar-severity"] as Severity) ?? (lvl === "ERROR" ? "high" : lvl === "WARNING" ? "medium" : "low"),
        category: r.metadata?.category ?? "code",
        cwe: r.metadata?.cwe,
        fix: r.metadata?.fix,
      });
    }
  }
  return ruleMeta;
}

/** Opengrep prefixes rule ids with the config file's folder path, so match on the end of the id. */
function shortRuleId(id: string): string {
  for (const key of rules().keys()) if (id === key || id.endsWith(`.${key}`)) return key;
  return id;
}

export async function runOpengrep(opts: RunOptions): Promise<RunResult> {
  const out = tmpFile("opengrep.sarif");
  const targets = opts.files ? opts.files.filter((f) => /\.(m?[jt]sx?|cjs|py)$/i.test(f) && fs.existsSync(path.join(opts.root, f))) : ["."];
  if (opts.files && targets.length === 0) {
    return { run: { tool: "opengrep", ok: true, skipped: true, durationMs: 0, count: 0 }, candidates: [] };
  }
  const args = ["scan", "--config", rulesFile(), "--sarif", "--output", out, "--quiet", "--disable-version-check"];
  for (const s of opts.skipPaths) args.push("--exclude", s.replace(/\/\*\*$/, ""));
  args.push(...(targets.length > 300 ? ["."] : targets));
  const r = await exec(toolPath("opengrep"), args, { cwd: opts.root, timeoutMs: 180_000 });
  if (!fs.existsSync(out)) {
    return { run: { tool: "opengrep", ok: false, durationMs: r.durationMs, count: 0, error: (r.stderr || r.stdout).slice(-600) }, candidates: [] };
  }
  const sarif = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
  const meta = rules();
  const candidates: Candidate[] = [];
  for (const res of sarif.runs?.[0]?.results ?? []) {
    const id = shortRuleId(res.ruleId);
    const m = meta.get(id) ?? { severity: "medium", category: "code" };
    const loc = res.locations?.[0]?.physicalLocation;
    const file = relPath(opts.root, loc?.artifactLocation?.uri ?? "");
    if (isSkipped(file, opts.skipPaths)) continue;
    const message = res.message?.text ?? id;
    candidates.push({
      tool: "opengrep",
      ruleId: id,
      kind: "code",
      title: message.split(/\.\s/)[0].replace(/\.$/, ""),
      message,
      severity: m.severity,
      file,
      startLine: loc?.region?.startLine ?? 0,
      endLine: loc?.region?.endLine ?? loc?.region?.startLine ?? 0,
      category: m.category,
      cwe: m.cwe,
      snippet: loc?.region?.snippet?.text,
      fix: m.fix,
    });
  }
  return { run: { tool: "opengrep", ok: true, durationMs: r.durationMs, count: candidates.length }, candidates };
}

// ---- Gitleaks -----------------------------------------------------------------

function gitleaksConfig(skipPaths: string[]): string {
  const cfg = tmpFile("gitleaks.toml");
  const paths = skipPaths.map((g) => `'''${globToRegex(g).source}'''`).join(", ");
  fs.writeFileSync(cfg, `[extend]\nuseDefault = true\n\n[[allowlists]]\ndescription = "Fivebar skip paths"\npaths = [${paths}]\n`);
  return cfg;
}

const SECRET_TITLES: Record<string, string> = {
  "github-pat": "GitHub token in code",
  "stripe-access-token": "Stripe key in code",
  "aws-access-token": "AWS key in code",
  "generic-api-key": "API key in code",
  "private-key": "Private key in code",
  "slack-bot-token": "Slack token in code",
  "openai-api-key": "OpenAI key in code",
  "anthropic-api-key": "Anthropic key in code",
};

export function redact(secret: string): string {
  const s = secret.trim();
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

export async function runGitleaks(opts: RunOptions): Promise<RunResult> {
  const targets = opts.files
    ? opts.files.filter((f) => fs.existsSync(path.join(opts.root, f)) && !isSkipped(f, opts.skipPaths))
    : ["."];
  if (opts.files && targets.length === 0 && !opts.commitRanges?.length) {
    return { run: { tool: "gitleaks", ok: true, skipped: true, durationMs: 0, count: 0 }, candidates: [] };
  }
  const cfg = gitleaksConfig(opts.skipPaths);
  const started = Date.now();
  const candidates: Candidate[] = [];
  let error: string | undefined;
  // Gitleaks takes one path at a time. A changed-files scan runs one small process per file.
  // A push also checks every commit in it, so a secret added and then deleted is still caught.
  const jobs: { t: string; args: string[] }[] = (targets.length > 40 ? ["."] : targets).map((t) => ({ t, args: ["dir", t] }));
  for (const range of opts.commitRanges ?? []) jobs.push({ t: ".", args: ["git", ".", `--log-opts=${range}`] });
  await Promise.all(
    jobs.map(async ({ t, args: base }) => {
      const out = tmpFile("gitleaks.sarif");
      const r = await exec(toolPath("gitleaks"), [...base, "--config", cfg, "--report-format", "sarif", "--report-path", out, "--no-banner", "--exit-code", "0", "--redact=0"], { cwd: opts.root, timeoutMs: 120_000 });
      if (!fs.existsSync(out)) {
        error = (r.stderr || r.stdout).slice(-600);
        return;
      }
      const sarif = JSON.parse(fs.readFileSync(out, "utf8"));
      fs.rmSync(out, { force: true });
      for (const res of sarif.runs?.[0]?.results ?? []) {
        const loc = res.locations?.[0]?.physicalLocation;
        const raw = loc?.artifactLocation?.uri ?? "";
        const file = relPath(opts.root, t === "." || raw.includes("/") || raw.includes("\\") ? raw : t);
        if (isSkipped(file, opts.skipPaths)) continue;
        const secret = String(loc?.region?.snippet?.text ?? "");
        const commit = String(res.partialFingerprints?.commitSha ?? "").slice(0, 7);
        candidates.push({
          tool: "gitleaks",
          ruleId: res.ruleId,
          kind: "secret",
          title: SECRET_TITLES[res.ruleId] ?? `Secret in code (${res.ruleId})`,
          message: `Gitleaks rule ${res.ruleId} matched a secret${commit ? ` in commit ${commit}` : ""}. Value: ${redact(secret)}.`,
          severity: "high",
          file,
          startLine: loc?.region?.startLine ?? 0,
          endLine: loc?.region?.endLine ?? loc?.region?.startLine ?? 0,
          category: "secret",
          cwe: "CWE-798",
          snippet: redact(secret),
          secretHash: crypto.createHash("sha256").update(secret).digest("hex"),
          fix: "Move the value to an environment variable or secret store, then rotate it. It may already be in git history, so rotating matters.",
        });
      }
    }),
  );
  fs.rmSync(cfg, { force: true });
  return { run: { tool: "gitleaks", ok: !error, durationMs: Date.now() - started, count: candidates.length, error }, candidates };
}

// ---- OSV-Scanner --------------------------------------------------------------

function cvssToSeverity(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

export async function runOsv(opts: RunOptions): Promise<RunResult> {
  if (opts.files && !opts.files.some((f) => LOCKFILES.test(f))) {
    return { run: { tool: "osv-scanner", ok: true, skipped: true, durationMs: 0, count: 0 }, candidates: [] };
  }
  const out = tmpFile("osv.json");
  // OSV-Scanner honours the .gitignore of any repo above the project. If an outer repo ignores
  // this folder it finds nothing, so turn ignores off only in that case.
  const outer = await exec("git", ["-C", path.dirname(opts.root), "check-ignore", "-q", opts.root], { timeoutMs: 10_000 });
  const args = ["scan", "source", "-r", ...(outer.code === 0 ? ["--no-ignore"] : []), ".", "--format", "json", "--output-file", out];
  const r = await exec(toolPath("osv-scanner"), args, { cwd: opts.root, timeoutMs: 180_000 });
  // A project with no lockfile or manifest is a clean result, not a failed scan.
  if (/No package sources found/i.test(r.stderr + r.stdout)) {
    fs.rmSync(out, { force: true });
    return { run: { tool: "osv-scanner", ok: true, durationMs: r.durationMs, count: 0 }, candidates: [] };
  }
  if (!fs.existsSync(out) || r.code > 1) {
    return { run: { tool: "osv-scanner", ok: false, durationMs: r.durationMs, count: 0, error: (r.stderr || r.stdout).slice(-600) }, candidates: [] };
  }
  const json = JSON.parse(fs.readFileSync(out, "utf8") || "{}");
  fs.rmSync(out, { force: true });
  const candidates: Candidate[] = [];
  for (const result of json.results ?? []) {
    const file = relPath(opts.root, result.source?.path ?? "");
    if (isSkipped(file, opts.skipPaths)) continue;
    for (const pkg of result.packages ?? []) {
      for (const group of pkg.groups ?? []) {
        const vulns = (pkg.vulnerabilities ?? []).filter((v: any) => group.ids.includes(v.id));
        const v = vulns[0] ?? {};
        const score = Number.parseFloat(group.max_severity);
        const fixedIn = (v.affected ?? [])
          .flatMap((a: any) => a.ranges ?? [])
          .flatMap((rg: any) => rg.events ?? [])
          .map((e: any) => e.fixed)
          .find(Boolean);
        const id = group.ids[0];
        candidates.push({
          tool: "osv-scanner",
          ruleId: id,
          kind: "dependency",
          title: `${pkg.package.name} ${pkg.package.version}: ${v.summary ?? "known vulnerability"}`,
          message: `${pkg.package.name}@${pkg.package.version} is affected by ${(group.aliases ?? group.ids).join(", ")}.`,
          severity: Number.isFinite(score) ? cvssToSeverity(score) : "medium",
          file,
          startLine: 0,
          endLine: 0,
          category: "vulnerable-dependency",
          fix: fixedIn ? `Upgrade ${pkg.package.name} to ${fixedIn} or later.` : `Check ${id} for a fixed version of ${pkg.package.name}.`,
          dependency: {
            name: pkg.package.name,
            version: pkg.package.version,
            ecosystem: pkg.package.ecosystem,
            vulnId: id,
            aliases: group.aliases ?? [],
            fixedIn,
          },
        });
      }
    }
  }
  return { run: { tool: "osv-scanner", ok: true, durationMs: r.durationMs, count: candidates.length }, candidates };
}

export const RUNNERS: Record<ToolName, (o: RunOptions) => Promise<RunResult>> = {
  opengrep: runOpengrep,
  gitleaks: runGitleaks,
  "osv-scanner": runOsv,
};

export { readLine };
