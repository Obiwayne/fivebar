import fs from "node:fs";
import path from "node:path";
import { fivebarCommand, fivebarLaunch } from "./paths.js";
import { gitDir } from "./git.js";
import { exec } from "./tools.js";
import { Store } from "./store.js";
import type { Project, ProjectConnection } from "./types.js";

const MARKER = "# fivebar pre-push hook";

export interface PlannedChange {
  part: keyof ProjectConnection;
  file: string;
  description: string;
  diff: string;
}

function prePushScript(): string {
  return `#!/bin/sh\n${MARKER}. Remove with "fivebar disconnect".\n${fivebarCommand()} hook pre-push "$@"\n`;
}

function stopHookCommand(): string {
  return `${fivebarCommand()} hook stop`;
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function backup(file: string) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.fivebar-bak`);
}

async function claude(args: string[], cwd: string) {
  // The Claude Code CLI is claude.exe on newer installs and claude.cmd on npm installs.
  const first = await exec("claude", args, { cwd, timeoutMs: 30_000 });
  if (first.code !== 0 && /ENOENT/.test(first.stderr) && process.platform === "win32") {
    return exec("cmd.exe", ["/d", "/s", "/c", "claude", ...args], { cwd, timeoutMs: 30_000 });
  }
  return first;
}

/** What "Connect" would change, shown to the user before anything is written. */
export async function planConnect(project: Project): Promise<PlannedChange[]> {
  const hooksDir = path.join(await gitDir(project.path), "hooks");
  const settings = path.join(project.path, ".claude", "settings.local.json");
  return [
    {
      part: "prePush",
      file: path.join(hooksDir, "pre-push"),
      description: "Runs the scanners on the files you're about to push and stops the push on a high or critical finding.",
      diff: prePushScript().split("\n").filter(Boolean).map((l) => `+ ${l}`).join("\n"),
    },
    {
      part: "stopHook",
      file: settings,
      description: "When Claude Code finishes a turn, Fivebar checks the files it changed and hands any findings back.",
      diff: `+ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": ${JSON.stringify(stopHookCommand())} } ] } ] }`,
    },
    {
      part: "claudeMcp",
      file: "claude mcp add --scope local fivebar",
      description: "Lets the agent ask Fivebar for findings, report fixes and re-scan.",
      diff: `+ fivebar -> ${fivebarCommand()} mcp --project "${project.path}"`,
    },
    {
      part: "findingsFile",
      file: path.join(project.path, ".fivebar", "findings.md"),
      description: "A findings list for Codex and other agents. Kept out of git.",
      diff: `+ .fivebar/findings.md  (and ".fivebar/" added to .git/info/exclude)`,
    },
  ];
}

export async function connect(store: Store, project: Project, parts: (keyof ProjectConnection)[] = ["prePush", "stopHook", "claudeMcp"]): Promise<Project> {
  const root = project.path;
  const conn = { ...project.connection };
  const notes: string[] = [];

  if (parts.includes("prePush")) {
    const hook = path.join(await gitDir(root), "hooks", "pre-push");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    if (fs.existsSync(hook) && !fs.readFileSync(hook, "utf8").includes(MARKER)) {
      backup(hook);
      notes.push(`Your existing pre-push hook was saved as ${path.basename(hook)}.fivebar-bak and replaced.`);
    }
    fs.writeFileSync(hook, prePushScript(), { mode: 0o755 });
    conn.prePush = true;
  }

  if (parts.includes("stopHook")) {
    const file = path.join(root, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    backup(file);
    const json = readJson(file);
    json.hooks ??= {};
    json.hooks.Stop ??= [];
    json.hooks.Stop = json.hooks.Stop.filter((h: any) => !JSON.stringify(h).includes(" hook stop"));
    json.hooks.Stop.push({ hooks: [{ type: "command", command: stopHookCommand(), timeout: 180 }] });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    conn.stopHook = true;
  }

  if (parts.includes("claudeMcp")) {
    await claude(["mcp", "remove", "--scope", "local", "fivebar"], root);
    const { exe, args, env } = fivebarLaunch();
    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    // -e takes several values, so it goes after the server name and is closed by "--".
    const r = await claude(["mcp", "add", "--scope", "local", "fivebar", ...envFlags, "--", exe, ...args, "mcp", "--project", root], root);
    if (r.code !== 0) throw new Error(`Could not register the MCP server with Claude Code: ${(r.stderr || r.stdout).trim()}`);
    conn.claudeMcp = true;
  }

  if (parts.includes("findingsFile")) {
    const exclude = path.join(await gitDir(root), "info", "exclude");
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    if (!cur.split(/\r?\n/).includes(".fivebar/")) fs.appendFileSync(exclude, `${cur.endsWith("\n") || !cur ? "" : "\n"}.fivebar/\n`);
    conn.findingsFile = true;
  }

  const updated = { ...project, connection: conn };
  await store.saveProject(updated);
  await store.addEvent(project.id, "connect", `Connected: ${parts.join(", ")}`, { notes });
  return updated;
}

export async function disconnect(store: Store, project: Project): Promise<Project> {
  const root = project.path;
  try {
    const hook = path.join(await gitDir(root), "hooks", "pre-push");
    if (fs.existsSync(hook) && fs.readFileSync(hook, "utf8").includes(MARKER)) {
      fs.rmSync(hook);
      if (fs.existsSync(`${hook}.fivebar-bak`)) fs.renameSync(`${hook}.fivebar-bak`, hook);
    }
  } catch { /* not a git repo any more */ }
  const file = path.join(root, ".claude", "settings.local.json");
  if (fs.existsSync(file)) {
    const json = readJson(file);
    if (json.hooks?.Stop) {
      json.hooks.Stop = json.hooks.Stop.filter((h: any) => !JSON.stringify(h).includes(" hook stop"));
      if (!json.hooks.Stop.length) delete json.hooks.Stop;
      if (!Object.keys(json.hooks).length) delete json.hooks;
      // Fivebar made the file if there was nothing to back up, so leave no empty file behind.
      if (!Object.keys(json).length && !fs.existsSync(`${file}.fivebar-bak`)) {
        fs.rmSync(file);
        if (!fs.readdirSync(path.dirname(file)).length) fs.rmdirSync(path.dirname(file));
      } else {
        fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
      }
    }
  }
  await claude(["mcp", "remove", "--scope", "local", "fivebar"], root);
  const updated: Project = { ...project, connection: { claudeMcp: false, stopHook: false, prePush: false, findingsFile: false } };
  await store.saveProject(updated);
  await store.addEvent(project.id, "disconnect", "Disconnected from Claude Code and git");
  return updated;
}

/**
 * Claude Code skips every hook when disableAllHooks is on, so a connected Stop hook would
 * never run. The highest-priority file that sets it wins: managed, local, project, then user.
 */
export function hooksBlockedBy(root: string): string | null {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const managed = process.platform === "win32" ? "C:\\Program Files\\ClaudeCode\\managed-settings.json" : "/etc/claude-code/managed-settings.json";
  const files = [managed, path.join(root, ".claude", "settings.local.json"), path.join(root, ".claude", "settings.json"), path.join(home, ".claude", "settings.json")];
  if (readJson(managed).allowManagedHooksOnly === true) return `${managed} (allowManagedHooksOnly)`;
  for (const file of files) {
    const v = readJson(file).disableAllHooks;
    if (v !== undefined) return v === true ? (home && file.startsWith(home) ? `~${file.slice(home.length)}` : file) : null;
  }
  return null;
}

/** Read the real state from disk, so the app shows what is actually installed. */
export async function checkConnection(project: Project): Promise<ProjectConnection> {
  const root = project.path;
  let prePush = false;
  try {
    const hook = path.join(await gitDir(root), "hooks", "pre-push");
    prePush = fs.existsSync(hook) && fs.readFileSync(hook, "utf8").includes(MARKER);
  } catch { /* no git */ }
  const settings = readJson(path.join(root, ".claude", "settings.local.json"));
  const stopHook = JSON.stringify(settings.hooks?.Stop ?? []).includes(" hook stop");
  const mcp = await claude(["mcp", "get", "fivebar"], root);
  return {
    prePush,
    stopHook,
    claudeMcp: mcp.code === 0 && /fivebar/i.test(mcp.stdout),
    findingsFile: fs.existsSync(path.join(root, ".fivebar", "findings.md")) || project.connection.findingsFile,
  };
}
