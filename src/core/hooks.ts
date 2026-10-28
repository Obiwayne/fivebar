import { pushChanges, workingTreeChanges } from "./git.js";
import { projectForDir } from "./projects.js";
import { isSkipped } from "./runners.js";
import { scanProject, ToolsMissingError } from "./scan.js";
import { Store } from "./store.js";
import type { AgentLoop, Finding } from "./types.js";

export interface HookResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function where(f: Finding): string {
  return `${f.file}${f.startLine ? `:${f.startLine}` : ""}`;
}

export function formatForAgent(findings: Finding[], round: number, cap: number): string {
  const lines = [`fivebar · security check · round ${round} of ${cap}`, `${findings.length} problem${findings.length === 1 ? "" : "s"} in the files you changed. Fix each one, then finish your turn and Fivebar re-checks.`, ""];
  findings.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.severity.toUpperCase()} ${f.title}`);
    lines.push(`   where: ${where(f)}${f.cwe ? ` (${f.cwe})` : ""}`);
    if (f.fix) lines.push(`   fix:   ${f.fix}`);
    lines.push(`   id:    ${f.id}  (found by ${f.tools.map((t) => t.tool).join(" + ")})`);
  });
  lines.push("", "If one of these is a false positive, say so in your reply and leave it. The owner can dismiss it in Fivebar.");
  return lines.join("\n");
}

interface StopInput {
  session_id?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/**
 * Claude Code runs this when the agent tries to finish a turn. If the files it changed have
 * problems, we answer {"decision":"block","reason":...} and the agent keeps working on the reason.
 * After the round cap we let it stop and mark the loop as needing the owner.
 */
export async function stopHook(raw: string, store?: Store): Promise<HookResult> {
  let input: StopInput = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* treat as empty */ }
  const cwd = input.cwd || process.cwd();
  store ??= await Store.open();
  const project = await projectForDir(store, cwd);
  if (!project) return { exitCode: 0 };

  const files = (await workingTreeChanges(project.path)).filter((f) => !isSkipped(f, project.settings.skipPaths));
  const sessionId = input.session_id || `cli-${project.id}`;
  let loop = await store.getLoop(sessionId);
  if (!files.length) {
    if (loop && loop.status === "running") {
      loop = { ...loop, status: "passed", updatedAt: new Date().toISOString() };
      await store.saveLoop(loop);
    }
    return { exitCode: 0 };
  }

  let outcome;
  try {
    outcome = await scanProject(store, project, { mode: "changed", files, trigger: "stop-hook" });
  } catch (e) {
    if (e instanceof ToolsMissingError) return { exitCode: 0, stdout: JSON.stringify({ systemMessage: `Fivebar: ${e.message}` }) };
    throw e;
  }
  const issues = outcome.inScope.filter((f) => project.settings.loopOn.includes(f.severity));
  const now = new Date().toISOString();
  loop ??= { sessionId, projectId: project.id, status: "running", rounds: [], startedAt: now, updatedAt: now, agent: "claude-code" } satisfies AgentLoop;

  if (!issues.length) {
    if (loop.rounds.length) {
      loop = { ...loop, status: "passed", updatedAt: now };
      await store.saveLoop(loop);
      await store.addEvent(project.id, "loop-passed", `Agent loop passed after ${loop.rounds.length} round${loop.rounds.length === 1 ? "" : "s"}`, { sessionId });
    }
    return { exitCode: 0 };
  }

  const cap = project.settings.roundCap;
  if (loop.rounds.length >= cap) {
    loop = { ...loop, status: "needs_owner", updatedAt: now };
    await store.saveLoop(loop);
    await store.addEvent(project.id, "loop-needs-owner", `Agent loop stopped after ${cap} rounds with ${issues.length} open`, { sessionId, ids: issues.map((f) => f.id) });
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        systemMessage: `Fivebar: ${issues.length} problem${issues.length === 1 ? "" : "s"} still open after ${cap} rounds. Stopped and waiting for you. Nothing was pushed.`,
      }),
    };
  }

  const round = loop.rounds.length + 1;
  const reason = formatForAgent(issues, round, cap);
  loop = {
    ...loop,
    status: "running",
    updatedAt: now,
    rounds: [...loop.rounds, { at: now, findingIds: issues.map((f) => f.id), message: reason }],
  };
  await store.saveLoop(loop);
  await store.addEvent(project.id, "loop-round", `Round ${round}: sent ${issues.length} finding${issues.length === 1 ? "" : "s"} back to the agent`, { sessionId });
  return { exitCode: 0, stdout: JSON.stringify({ decision: "block", reason }) };
}

/** git runs this before a push. Exit code 1 cancels the push. */
export async function prePushHook(cwd: string, stdin: string, store?: Store, timeoutMs = 60_000): Promise<HookResult> {
  store ??= await Store.open();
  const project = await projectForDir(store, cwd);
  if (!project) return { exitCode: 0 };

  const work = (async (): Promise<HookResult> => {
    const changed = await pushChanges(project.path, stdin);
    const files = changed?.files.filter((f) => !isSkipped(f, project.settings.skipPaths));
    if (changed && !files!.length && !changed.ranges.length) return { exitCode: 0 };
    const outcome = await scanProject(
      store!,
      project,
      changed ? { mode: "changed", files, trigger: "push", commitRanges: changed.ranges } : { mode: "full", trigger: "push" },
    );
    // Block on anything this scan reported in the pushed files or commits, not on old problems elsewhere.
    const blocking = [...new Map([...outcome.inScope, ...outcome.reported].map((f) => [f.id, f])).values()]
      .filter((f) => project.settings.blockOn.includes(f.severity))
      .filter((f) => !changed || f.kind !== "dependency" || outcome.reported.some((r) => r.id === f.id));
    const tools = outcome.scan.tools.filter((t) => !t.skipped).map((t) => t.tool).join(" ");
    const head = `fivebar ▸ ${files ? `${files.length} changed file${files.length === 1 ? "" : "s"}` : "full scan"} · ${tools} · ${((Date.parse(outcome.scan.finishedAt) - Date.parse(outcome.scan.startedAt)) / 1000).toFixed(1)} s`;
    if (!blocking.length) {
      await store!.addEvent(project.id, "push-checked", `Push checked: clean`, { scanId: outcome.scan.id });
      return { exitCode: 0, stderr: `${head}\nfivebar ▸ clean\n` };
    }
    const lines = [head];
    for (const f of blocking.slice(0, 8)) lines.push(`✕ ${f.severity.toUpperCase().padEnd(8)} ${f.title.slice(0, 48).padEnd(48)} ${where(f)}`);
    if (blocking.length > 8) lines.push(`  …and ${blocking.length - 8} more`);
    lines.push(`fivebar ▸ push blocked. ${blocking.length} finding${blocking.length === 1 ? "" : "s"} at ${project.settings.blockOn.join(" or ")}.`);
    if (blocking.some((f) => f.kind === "secret" && /in commit/.test(f.tools[0]?.message ?? ""))) {
      lines.push(`          a secret is in a commit you're pushing. Rotate the key, then remove it from history (git rebase -i) before pushing.`);
    }
    lines.push(`          open Fivebar to see them, or push with --no-verify to skip the check.`);
    await store!.addEvent(project.id, "push-blocked", `Push blocked: ${blocking.length} finding${blocking.length === 1 ? "" : "s"}`, { ids: blocking.map((f) => f.id) });
    return { exitCode: 1, stderr: lines.join("\n") + "\n" };
  })();

  const timeout = new Promise<HookResult>((resolve) =>
    setTimeout(() => resolve({ exitCode: 0, stderr: `fivebar ▸ scan took longer than ${timeoutMs / 1000} s, so the push goes through. Check Fivebar afterwards.\n` }), timeoutMs),
  );
  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    if (e instanceof ToolsMissingError) return { exitCode: 0, stderr: `fivebar ▸ ${e.message} Push not checked.\n` };
    return { exitCode: 0, stderr: `fivebar ▸ check failed (${(e as Error).message}). Push not checked.\n` };
  }
}
