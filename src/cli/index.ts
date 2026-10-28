import path from "node:path";
import { checkConnection, connect, disconnect, hooksBlockedBy, planConnect } from "../core/connect.js";
import { prePushHook, stopHook } from "../core/hooks.js";
import { addProject, detect, projectForDir } from "../core/projects.js";
import { scanProject } from "../core/scan.js";
import { workingTreeChanges } from "../core/git.js";
import { Store } from "../core/store.js";
import { installTools, toolStatus } from "../core/tools.js";
import type { ProjectConnection } from "../core/types.js";

const HELP = `fivebar: five checks before every push

  fivebar tools install           download the scanners (checks SHA-256)
  fivebar tools status            show which scanners are installed
  fivebar add <folder>            add a project
  fivebar scan [folder] [--changed]  scan a project (whole project by default)
  fivebar findings [folder]       list open findings
  fivebar plan [folder]           show what "connect" would change
  fivebar connect [folder] [--parts prePush,stopHook,claudeMcp,findingsFile]
  fivebar disconnect [folder]     remove the hooks and the MCP server
  fivebar status [folder]         show what is connected
  fivebar serve [--port 4870]     run the app's local API and UI
  fivebar mcp --project <folder>  run the MCP server (Claude Code starts this)
  fivebar hook stop               Claude Code Stop hook (reads JSON on stdin)
  fivebar hook pre-push           git pre-push hook (reads refs on stdin)
`;

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function projectArg(store: Store, args: string[]) {
  const folder = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
  const p = await projectForDir(store, folder);
  if (!p) throw new Error(`${folder} is not a Fivebar project yet. Run "fivebar add ${folder}" first.`);
  return p;
}

async function main(argv: string[]) {
  const [cmd, sub, ...rest] = argv;
  switch (cmd) {
    case "hook": {
      const stdin = await readStdin();
      const r = sub === "stop" ? await stopHook(stdin) : sub === "pre-push" ? await prePushHook(process.cwd(), stdin) : { exitCode: 2, stderr: HELP };
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      return r.exitCode;
    }
    case "mcp": {
      const { runMcpServer } = await import("../mcp/server.js");
      await runMcpServer(flag(argv, "--project") ?? process.cwd());
      return -1; // keep running
    }
    case "serve": {
      const { startServer } = await import("../server/http.js");
      const port = Number(flag(argv, "--port") ?? 4870);
      const s = await startServer({ port, token: process.env.FIVEBAR_TOKEN ?? "dev" });
      console.log(`Fivebar is running at ${s.url}`);
      return -1;
    }
    case "tools": {
      if (sub === "install") {
        const s = await installTools((m) => console.log(m));
        for (const t of s) console.log(`${t.installed ? "✓" : "✗"} ${t.label} ${t.version}`);
      } else {
        for (const t of toolStatus()) console.log(`${t.installed ? "✓" : "✗"} ${t.label} ${t.version} (${t.licence})`);
      }
      return 0;
    }
  }

  const store = await Store.open();
  const args = [sub, ...rest].filter((a): a is string => a !== undefined);
  switch (cmd) {
    case "add": {
      const p = await addProject(store, args[0] ?? process.cwd());
      const d = await detect(p.path);
      console.log(`Added ${p.name} (${p.id})`);
      console.log(`Languages: ${d.languages.join(", ") || "none found"} · Package managers: ${d.managers.join(", ") || "none"} · Tests: ${d.testCommand ?? "none found"}`);
      return 0;
    }
    case "scan": {
      const p = await projectArg(store, args);
      const changed = args.includes("--changed");
      const files = changed ? await workingTreeChanges(p.path) : undefined;
      const o = await scanProject(store, p, changed ? { mode: "changed", files, trigger: "manual" } : { mode: "full", trigger: "manual" });
      for (const t of o.scan.tools) console.log(`${t.ok ? (t.skipped ? "-" : "✓") : "✗"} ${t.tool.padEnd(12)} ${t.skipped ? "skipped" : `${t.count} result${t.count === 1 ? "" : "s"}`} · ${(t.durationMs / 1000).toFixed(1)} s${t.error ? ` · ${t.error.split("\n")[0]}` : ""}`);
      console.log(`Score ${o.scan.score} · open: ${Object.entries(o.scan.openCounts).map(([k, v]) => `${v} ${k}`).join(", ")} · ${o.newFindings.length} new, ${o.closed.length} closed`);
      return 0;
    }
    case "findings": {
      const p = await projectArg(store, args);
      const open = await store.listFindings(p.id, { status: "open" });
      for (const f of open) console.log(`${f.severity.toUpperCase().padEnd(8)} ${f.title.slice(0, 60).padEnd(60)} ${f.file}${f.startLine ? `:${f.startLine}` : ""}  [${f.tools.map((t) => t.tool).join("+")}] ${f.id}`);
      if (!open.length) console.log("No open findings.");
      return 0;
    }
    case "review": {
      const p = await projectArg(store, args);
      const { runReview, DIMENSIONS } = await import("../core/review.js");
      const r = await runReview(store, p, { ai: !args.includes("--no-ai") });
      for (const t of r.checks) console.log(`${t.ok === null ? "-" : t.ok ? "✓" : "✗"} ${t.name}: ${t.detail}`);
      if (r.aiError) console.log(`AI reviewer: ${r.aiError}`);
      for (const d of DIMENSIONS) console.log(`${String(r.scores[d].score).padStart(2)}/5 ${d.padEnd(16)} ${r.scores[d].reason}`);
      console.log(r.passed ? "Gate passed: 5/5 on all five." : `Gate shut: ${DIMENSIONS.filter((d) => r.scores[d].score === 5).length} of 5 bars at 5.`);
      return 0;
    }
    case "plan": {
      const p = await projectArg(store, args);
      for (const c of await planConnect(p)) console.log(`\n${c.part}: ${c.description}\n  ${c.file}\n${c.diff.replace(/^/gm, "  ")}`);
      return 0;
    }
    case "connect": {
      const p = await projectArg(store, args);
      const parts = (flag(args, "--parts")?.split(",") ?? ["prePush", "stopHook", "claudeMcp"]) as (keyof ProjectConnection)[];
      const u = await connect(store, p, parts);
      console.log(`Connected ${u.name}:`, u.connection);
      return 0;
    }
    case "disconnect": {
      const p = await projectArg(store, args);
      await disconnect(store, p);
      console.log(`Disconnected ${p.name}.`);
      return 0;
    }
    case "status": {
      const p = await projectArg(store, args);
      console.log(p.name, await checkConnection(p));
      const blocked = hooksBlockedBy(p.path);
      if (blocked) console.log(`Warning: Claude Code hooks are turned off by disableAllHooks in ${blocked}, so the Stop hook will not run.`);
      return 0;
    }
    default:
      process.stdout.write(HELP);
      return cmd ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => { if (code >= 0) process.exit(code); },
  (e: Error) => {
    process.stderr.write(`fivebar: ${e.message}\n`);
    // Hooks must never break the user's git or Claude Code because Fivebar failed.
    process.exit(process.argv[2] === "hook" ? 0 : 1);
  },
);
