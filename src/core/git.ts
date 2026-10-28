import fs from "node:fs";
import path from "node:path";
import { exec } from "./tools.js";

async function git(root: string, args: string[]): Promise<string> {
  const r = await exec("git", args, { cwd: root, timeoutMs: 30_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

function lines(s: string): string[] {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export async function isGitRepo(root: string): Promise<boolean> {
  return fs.existsSync(path.join(root, ".git")) || (await exec("git", ["rev-parse", "--git-dir"], { cwd: root })).code === 0;
}

export async function gitDir(root: string): Promise<string> {
  const d = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  return path.resolve(root, d);
}

/** Folders git ignores (build output, virtualenvs, caches) as skip globs. Scanners don't read .gitignore. */
export async function ignoredDirs(root: string): Promise<string[]> {
  const r = await exec("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"], { cwd: root, timeoutMs: 30_000 });
  if (r.code !== 0) return [];
  return lines(r.stdout).filter((l) => l.endsWith("/")).map((d) => `${d}**`);
}

/** Files the agent has touched and not committed: modified, staged and new. */
export async function workingTreeChanges(root: string): Promise<string[]> {
  const set = new Set<string>();
  const hasHead = (await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: root })).code === 0;
  if (hasHead) for (const f of lines(await git(root, ["diff", "--name-only", "HEAD"]))) set.add(f);
  else for (const f of lines(await git(root, ["diff", "--name-only", "--cached"]))) set.add(f);
  for (const f of lines(await git(root, ["ls-files", "--others", "--exclude-standard"]))) set.add(f);
  return [...set].filter((f) => fs.existsSync(path.join(root, f)));
}

const ZERO = /^0+$/;

/**
 * Files changed by a push. Git gives the hook one line per ref on stdin:
 * "<local ref> <local sha> <remote ref> <remote sha>".
 */
export interface PushChanges {
  /** Files changed by the pushed commits that still exist. */
  files: string[];
  /** Commit ranges being pushed, so secrets added and removed inside the push are still caught. */
  ranges: string[];
}

export async function pushChanges(root: string, stdin: string): Promise<PushChanges | undefined> {
  const set = new Set<string>();
  const ranges: string[] = [];
  for (const line of lines(stdin)) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // deleting a branch
    let range: string;
    if (remoteSha && !ZERO.test(remoteSha)) range = `${remoteSha}..${localSha}`;
    else {
      // New branch: compare with where it left the default branch, or check every file if we can't tell.
      const base = await exec("git", ["merge-base", localSha, "origin/HEAD"], { cwd: root });
      if (base.code !== 0) return undefined;
      range = `${base.stdout.trim()}..${localSha}`;
    }
    ranges.push(range);
    for (const f of lines(await git(root, ["diff", "--name-only", range]))) set.add(f);
  }
  return { files: [...set].filter((f) => fs.existsSync(path.join(root, f))), ranges };
}

export async function currentBranch(root: string): Promise<string> {
  try {
    return (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return "";
  }
}

export async function headSha(root: string): Promise<string> {
  try {
    return (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
  } catch {
    return "";
  }
}
