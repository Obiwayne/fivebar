import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { checkConnection, connect, disconnect, hooksBlockedBy, planConnect } from "../core/connect.js";
import { headSha, currentBranch } from "../core/git.js";
import { openCounts, score } from "../core/merge.js";
import { appRoot } from "../core/paths.js";
import { addProject, detect } from "../core/projects.js";
import { listReviews, runReview } from "../core/review.js";
import { scanProject } from "../core/scan.js";
import { Store } from "../core/store.js";
import { exec, installTools, toolStatus } from "../core/tools.js";
import type { FindingStatus, Project, ProjectConnection } from "../core/types.js";

export interface ServerOptions {
  port: number;
  token: string;
  host?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon",
};

async function body(req: http.IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "Body is not JSON"); }
}

async function versionOf(cmd: string, args = ["--version"]): Promise<string | null> {
  let r = await exec(cmd, args, { timeoutMs: 8000 });
  if (r.code !== 0 && process.platform === "win32" && /ENOENT/.test(r.stderr)) r = await exec("cmd.exe", ["/d", "/s", "/c", cmd, ...args], { timeoutMs: 8000 });
  return r.code === 0 ? (r.stdout || r.stderr).trim().split(/\r?\n/)[0] : null;
}

export async function projectSummary(store: Store, p: Project) {
  const [findings, scans, loops] = await Promise.all([store.listFindings(p.id), store.listScans(p.id, 30), store.listLoops(p.id, 1)]);
  // A session that ended without a clean pass would show "running" for ever. After 30 idle minutes call it paused.
  const loop = loops[0] && loops[0].status === "running" && Date.now() - Date.parse(loops[0].updatedAt) > 30 * 60_000 ? { ...loops[0], status: "paused" as const } : loops[0];
  return {
    ...p,
    score: scans.length ? score(findings) : null,
    openCounts: openCounts(findings),
    lastScan: scans[0] ?? null,
    trend: scans.map((s) => ({ at: s.finishedAt, score: s.score })).reverse(),
    loop: loop ?? null,
  };
}

export async function startServer(opts: ServerOptions): Promise<{ url: string; close: () => void; port: number }> {
  const store = await Store.open();
  const uiDir = path.join(appRoot(), "dist", "ui");
  const scanning = new Set<string>();
  const reviewing = new Set<string>();

  async function project(id: string): Promise<Project> {
    const p = await store.getProject(id);
    if (!p) throw new HttpError(404, "Project not found");
    return p;
  }

  async function api(method: string, parts: string[], req: http.IncomingMessage, url: URL): Promise<unknown> {
    const [a, id, b, fid, c] = parts;
    if (a === "state" && method === "GET") {
      const projects = await store.listProjects();
      return {
        tools: toolStatus(),
        settings: await store.getSetting("app", { setupDone: false, agents: ["claude-code"] }),
        projects: await Promise.all(projects.map((p) => projectSummary(store, p))),
      };
    }
    if (a === "environment" && method === "GET") {
      const [claude, codex, git, gh, tailscale] = await Promise.all([
        versionOf("claude"), versionOf("codex"), versionOf("git"), versionOf("gh"), versionOf("tailscale", ["version"]),
      ]);
      return { claude, codex, git, gh, tailscale };
    }
    if (a === "settings" && method === "POST") {
      const cur = await store.getSetting<Record<string, unknown>>("app", {});
      const next = { ...cur, ...(await body(req)) };
      await store.setSetting("app", next);
      return next;
    }
    if (a === "tools" && id === "install" && method === "POST") return installTools();
    if (a !== "projects") throw new HttpError(404, "Unknown route");

    if (!id) {
      if (method === "POST") {
        const { path: folder } = await body(req);
        if (!folder) throw new HttpError(400, "Give a folder path");
        const p = await addProject(store, String(folder));
        return { project: await projectSummary(store, p), detected: await detect(p.path) };
      }
      throw new HttpError(405, "Method not allowed");
    }
    const p = await project(id);
    if (!b) {
      if (method === "DELETE") { await store.removeProject(p.id); return { ok: true }; }
      if (method === "PATCH") {
        const patch = await body(req);
        const updated = { ...p, settings: { ...p.settings, ...(patch.settings ?? {}) } };
        await store.saveProject(updated);
        return projectSummary(store, updated);
      }
      const [summary, detected, events, scans, loops] = await Promise.all([
        projectSummary(store, p), detect(p.path), store.listEvents(p.id, 100), store.listScans(p.id, 50), store.listLoops(p.id, 20),
      ]);
      return { ...summary, detected, events, scans, loops, branch: await currentBranch(p.path), head: await headSha(p.path) };
    }
    if (b === "findings") {
      if (!fid) {
        const status = url.searchParams.get("status") ?? undefined;
        return store.listFindings(p.id, status ? { status } : {});
      }
      const f = await store.getFinding(p.id, fid);
      if (!f) throw new HttpError(404, "Finding not found");
      if (c === "status" && method === "POST") {
        const { status, reason } = await body(req) as { status: FindingStatus; reason?: string };
        if (!["open", "false_positive", "accepted"].includes(status)) throw new HttpError(400, "Status must be open, false_positive or accepted");
        if (status !== "open" && !reason?.trim()) throw new HttpError(400, "A reason is required");
        const updated = {
          ...f, status, reason: reason?.trim(),
          expiresAt: status === "accepted" ? new Date(Date.now() + 30 * 86400_000).toISOString() : undefined,
        };
        await store.saveFinding(updated);
        await store.addEvent(p.id, `finding-${status}`, `${status === "false_positive" ? "Marked false positive" : status === "accepted" ? "Accepted risk" : "Reopened"}: ${f.title}`, { id: f.id, reason });
        return updated;
      }
      if (c === "source") {
        const lines = fs.existsSync(path.join(p.path, f.file)) ? fs.readFileSync(path.join(p.path, f.file), "utf8").split(/\r?\n/) : [];
        const from = Math.max(1, f.startLine - 4);
        const to = Math.min(lines.length, (f.endLine || f.startLine) + 4);
        return { from, lines: f.kind === "secret" ? [] : lines.slice(from - 1, to) };
      }
      return f;
    }
    if (b === "scan" && method === "POST") {
      if (scanning.has(p.id)) throw new HttpError(409, "A scan is already running for this project");
      scanning.add(p.id);
      try {
        const o = await scanProject(store, p, { mode: "full", trigger: "manual" });
        return { scan: o.scan, newCount: o.newFindings.length, closedCount: o.closed.length };
      } finally {
        scanning.delete(p.id);
      }
    }
    if (b === "reviews" && method === "GET") return listReviews(store, p.id);
    if (b === "review" && method === "POST") {
      if (reviewing.has(p.id)) throw new HttpError(409, "A review is already running for this project");
      reviewing.add(p.id);
      try {
        return await runReview(store, p);
      } finally {
        reviewing.delete(p.id);
      }
    }
    if (b === "connection") return { actual: await checkConnection(p), plan: await planConnect(p), hooksBlockedBy: hooksBlockedBy(p.path) };
    if (b === "connect" && method === "POST") {
      const { parts } = await body(req) as { parts?: (keyof ProjectConnection)[] };
      return connect(store, p, parts);
    }
    if (b === "disconnect" && method === "POST") return disconnect(store, p);
    throw new HttpError(404, "Unknown route");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname.startsWith("/api/")) {
        const token = req.headers["x-fivebar-token"] ?? url.searchParams.get("token");
        if (token !== opts.token) throw new HttpError(401, "Missing or wrong token");
        const out = await api(req.method ?? "GET", url.pathname.slice(5).split("/").filter(Boolean), req, url);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(out));
        return;
      }
      // Static UI. The token is put into the page so only this app's own window can call the API.
      let file = path.join(uiDir, decodeURIComponent(url.pathname));
      if (!file.startsWith(uiDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(uiDir, "index.html");
      if (!fs.existsSync(file)) throw new HttpError(404, "UI not built. Run npm run build:ui.");
      let data: string | Buffer = fs.readFileSync(file);
      if (file.endsWith("index.html")) data = data.toString("utf8").replace("</head>", `<meta name="fivebar-token" content="${opts.token}"></head>`);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return { url: `http://${host}:${port}/`, port, close: () => server.close() };
}
