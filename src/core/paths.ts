import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where Fivebar keeps its database. Override with FIVEBAR_DATA_DIR (tests use this). */
export function dataDir(): string {
  const base = process.env.FIVEBAR_DATA_DIR
    ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "Fivebar") : path.join(os.homedir(), ".fivebar"));
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/** Where the scanner binaries live. */
export function toolsDir(): string {
  const base = process.env.FIVEBAR_TOOLS_DIR
    ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Fivebar", "tools") : path.join(os.homedir(), ".fivebar", "tools"));
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/** The fivebar package root: the folder holding package.json, rules/ and dist/. */
export function appRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.readFileSync(pkg, "utf8").includes('"name": "fivebar"')) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find the fivebar install folder");
}

export function rulesFile(): string {
  return path.join(appRoot(), "rules", "fivebar-rules.yml");
}

/**
 * How other programs (git, Claude Code) start Fivebar's CLI. From source it's `node dist/cli/index.js`. The installed
 * app has no Node, so it runs the same CLI through its own Electron binary with ELECTRON_RUN_AS_NODE=1.
 */
export function fivebarLaunch(): { exe: string; args: string[]; env: Record<string, string> } {
  const cli = toPosix(path.join(appRoot(), "dist", "cli", "index.js"));
  if (isInstalledApp()) return { exe: toPosix(process.execPath), args: [cli], env: { ELECTRON_RUN_AS_NODE: "1" } };
  return { exe: "node", args: [cli], env: {} };
}

/** True inside the installed app (its CLI or its window), false when run from source with node or `electron .`. */
export function isInstalledApp(): boolean {
  return Boolean(process.versions.electron) && !/[\\/]node_modules[\\/]electron[\\/]/i.test(process.execPath);
}

/** The command line for a shell: the git pre-push hook and Claude Code's Stop hook. */
export function fivebarCommand(): string {
  if (process.env.FIVEBAR_COMMAND) return process.env.FIVEBAR_COMMAND;
  const { exe, args, env } = fivebarLaunch();
  const vars = Object.entries(env).map(([k, v]) => `${k}=${v} `).join("");
  return `${vars}${exe === "node" ? "node" : `"${exe}"`} ${args.map((a) => `"${a}"`).join(" ")}`;
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
