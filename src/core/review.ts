import { exec } from "./tools.js";
import { workingTreeChanges } from "./git.js";
import { detect } from "./projects.js";
import { Store } from "./store.js";
import type { Finding, Project, Severity } from "./types.js";

export const DIMENSIONS = ["security", "correctness", "readability", "tests", "maintainability"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const RUBRIC: Record<Dimension, string[]> = {
  security: [
    "1: Any critical finding: injection, a committed secret, remote code execution, auth bypass.",
    "2: One high finding, for example an unvalidated redirect or a missing auth check on a non-admin route.",
    "3: One medium finding, or a new dependency with a known low or medium advisory.",
    "4: One low finding, or one missing hardening step with no known exploit.",
    "5: No open findings in the changed code. Input from outside is validated. Secrets come from the environment. Auth checks are on every new route.",
  ],
  correctness: [
    "1: The build breaks, or several tests fail.",
    "2: One test fails, or the type check fails.",
    "3: Tests pass, but one error path is swallowed or returns the wrong result.",
    "4: Tests pass, but one edge case is unhandled (empty input, null, a boundary) with a named input that shows it.",
    "5: Tests pass. No logic bug, unhandled error path or edge case that breaks the intent.",
  ],
  readability: [
    "1: Code a reviewer cannot follow without running it.",
    "2: Code that contradicts the project's existing patterns.",
    "3: Several unclear names, or nesting more than 3 levels deep in one place.",
    "4: One unclear name, or one function that does two jobs and should split.",
    "5: Names say what things are. No function over 50 lines without a reason. Matches the surrounding style.",
  ],
  tests: [
    "1: New behaviour with no tests, or tests deleted or skipped to make the suite pass.",
    "2: Tests exist but would pass even if the feature broke.",
    "3: New behaviour is tested only on the happy path.",
    "4: One new branch or error path has no test. Name it.",
    "5: Every new behaviour has a test. Every bug fix has a test that failed before the fix.",
  ],
  maintainability: [
    "1: Copy-pasted blocks across files, or a change that couples modules that were separate.",
    "2: Hard-coded values that belong in config, or a change that touches unrelated files.",
    "3: A new dependency for something the standard library or an existing dependency already does.",
    "4: One piece of duplicated logic that should reuse an existing helper. Name the helper.",
    "5: No duplicated logic. No new dependency without a reason. No dead code left behind.",
  ],
};

export interface DimensionResult {
  score: number;
  aiScore: number | null;
  reason: string;
  rubricLine?: string;
  fix?: string;
  floor?: { max: number; because: string };
}

export interface ToolCheck {
  name: string;
  ok: boolean | null;
  detail: string;
  durationMs: number;
}

export interface Review {
  id: string;
  projectId: string;
  at: string;
  target: string;
  files: string[];
  scores: Record<Dimension, DimensionResult>;
  checks: ToolCheck[];
  passed: boolean;
  aiError?: string;
}

const FLOOR_BY_SEVERITY: Record<Severity, number> = { critical: 1, high: 2, medium: 3, low: 4 };

async function claudeJson(prompt: string, input: string, cwd: string): Promise<{ text: string; error?: string }> {
  const args = ["-p", prompt, "--output-format", "json", "--max-turns", "8", "--allowedTools", "Read,Grep,Glob"];
  let r = await exec("claude", args, { cwd, input, timeoutMs: 600_000 });
  if (r.code !== 0 && /ENOENT/.test(r.stderr) && process.platform === "win32") {
    r = await exec("cmd.exe", ["/d", "/s", "/c", "claude", ...args], { cwd, input, timeoutMs: 600_000 });
  }
  if (r.code !== 0) return { text: "", error: (r.stderr || r.stdout).trim().slice(-500) || `claude exited with ${r.code}` };
  try {
    const out = JSON.parse(r.stdout);
    if (out.is_error) return { text: "", error: String(out.result ?? "Claude returned an error") };
    return { text: String(out.result ?? "") };
  } catch {
    return { text: r.stdout };
  }
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

async function runTests(project: Project): Promise<ToolCheck> {
  const d = await detect(project.path);
  if (!d.testCommand) return { name: "tests", ok: null, detail: "No test command found", durationMs: 0 };
  const cmd = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", d.testCommand]] as const : ["sh", ["-c", d.testCommand]] as const;
  const r = await exec(cmd[0], [...cmd[1]], { cwd: project.path, timeoutMs: 600_000 });
  const tail = (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
  return { name: d.testCommand, ok: r.code === 0, detail: r.code === 0 ? `Passed. ${tail}` : `Failed (exit ${r.code}). ${tail}`, durationMs: r.durationMs };
}

/**
 * Score the current change on the five dimensions. Two reviewers must agree: the AI reviewer
 * (claude -p, read-only tools) and the deterministic checks, which set hard limits it cannot score above.
 */
// Dependency advisories count for every change, because the change ships with them.
function scopeText(list: Finding[]): string {
  const deps = list.filter((f) => f.kind === "dependency").length;
  const files = list.length - deps;
  return `${list.length} open (${[files && `${files} in the changed files`, deps && `${deps} in dependencies`].filter(Boolean).join(", ")})`;
}

export async function runReview(store: Store, project: Project, opts: { ai?: boolean } = {}): Promise<Review> {
  const root = project.path;
  const files = await workingTreeChanges(root);
  let target = "uncommitted changes";
  let diff = (await exec("git", ["diff", "HEAD"], { cwd: root })).stdout;
  if (!diff.trim()) {
    diff = (await exec("git", ["show", "HEAD", "--format=%h %s%n"], { cwd: root })).stdout;
    target = "the last commit";
  }
  const open = await store.listFindings(project.id, { status: "open" });
  const changedFiles = files.length ? files : (await exec("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root })).stdout.split(/\r?\n/).filter(Boolean);
  const inChange = open.filter((f) => changedFiles.includes(f.file) || f.kind === "dependency");

  const checks: ToolCheck[] = [await runTests(project)];
  const worst = inChange.reduce<Finding | undefined>((w, f) => (!w || FLOOR_BY_SEVERITY[f.severity] < FLOOR_BY_SEVERITY[w.severity] ? f : w), undefined);
  checks.push({ name: "scanners", ok: !worst, detail: worst ? `${scopeText(inChange)}, worst: ${worst.severity} ${worst.title}` : "No open findings in the changed files or dependencies", durationMs: 0 });

  let ai: Partial<Record<Dimension, { score: number; reason: string; rubricLine?: string; fix?: string }>> = {};
  let aiError: string | undefined;
  if (opts.ai !== false && diff.trim()) {
    const prompt = "You are Fivebar's code reviewer. Score the change on stdin from 1 to 5 on each of security, correctness, readability, tests and maintainability, using only the rubric given. Reply with one JSON object and nothing else.";
    const input = [
      "RUBRIC (score each dimension with the highest line whose description fits; a 4 must name one specific fixable thing):",
      ...DIMENSIONS.map((d) => `\n${d.toUpperCase()}\n${RUBRIC[d].join("\n")}`),
      "\nOPEN SCANNER FINDINGS IN THE CHANGED FILES AND THE PROJECT DEPENDENCIES:",
      inChange.length ? inChange.map((f) => `- ${f.severity} ${f.title} at ${f.file}:${f.startLine}`).join("\n") : "- none",
      `\nREPLY FORMAT: {"security":{"score":5,"reason":"one sentence","rubricLine":"the rubric line used","fix":"what to change for a 5, or empty"}, "correctness":{...}, "readability":{...}, "tests":{...}, "maintainability":{...}}`,
      `\nTHE CHANGE (${target}):\n`,
      diff.slice(0, 60_000),
    ].join("\n");
    const res = await claudeJson(prompt, input, root);
    if (res.error) aiError = res.error;
    else {
      try { ai = extractJson(res.text); } catch { aiError = "The AI reviewer's reply was not valid JSON."; }
    }
  } else if (!diff.trim()) aiError = "Nothing to review: no changes and no commits.";

  const tests = checks[0];
  const scores = {} as Record<Dimension, DimensionResult>;
  for (const d of DIMENSIONS) {
    const a = ai[d];
    let floor: DimensionResult["floor"];
    if (d === "security" && worst) floor = { max: FLOOR_BY_SEVERITY[worst.severity], because: `Open ${worst.severity} finding: ${worst.title}` };
    if (d === "correctness" && tests.ok === false) floor = { max: 2, because: `Tests failed: ${tests.detail}` };
    if (d === "tests" && tests.ok === null) floor = { max: 3, because: "This project has no test suite" };
    const aiScore = a && Number.isFinite(Number(a.score)) ? Math.max(1, Math.min(5, Math.round(Number(a.score)))) : null;
    const base = aiScore ?? (floor ? floor.max : 0);
    const score = floor ? Math.min(base || floor.max, floor.max) : base;
    scores[d] = {
      score,
      aiScore,
      reason: floor && (aiScore === null || aiScore > floor.max) ? floor.because : a?.reason ?? (aiScore === null ? "Not scored: the AI reviewer did not run." : ""),
      rubricLine: a?.rubricLine,
      fix: a?.fix,
      floor,
    };
  }
  const review: Review = {
    id: `${Date.now()}`,
    projectId: project.id,
    at: new Date().toISOString(),
    target,
    files: changedFiles,
    scores,
    checks,
    passed: DIMENSIONS.every((d) => scores[d].score === 5),
    aiError,
  };
  const history = await store.getSetting<Review[]>(`reviews:${project.id}`, []);
  await store.setSetting(`reviews:${project.id}`, [review, ...history].slice(0, 20));
  const bars = DIMENSIONS.filter((d) => scores[d].score === 5).length;
  await store.addEvent(project.id, "review", `Review gate: ${bars} of 5 bars at 5${review.passed ? ", passed" : ""}`, { id: review.id });
  return review;
}

export async function listReviews(store: Store, projectId: string): Promise<Review[]> {
  return store.getSetting<Review[]>(`reviews:${projectId}`, []);
}
