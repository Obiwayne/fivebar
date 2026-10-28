import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { workingTreeChanges } from "../core/git.js";
import { addProject, projectForDir } from "../core/projects.js";
import { scanProject } from "../core/scan.js";
import { Store } from "../core/store.js";
import type { Finding, Project } from "../core/types.js";

function brief(f: Finding) {
  return {
    id: f.id,
    severity: f.severity,
    title: f.title,
    where: `${f.file}${f.startLine ? `:${f.startLine}` : ""}`,
    cwe: f.cwe,
    fix: f.fix,
    foundBy: f.tools.map((t) => t.tool),
    status: f.status,
  };
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** The MCP server Claude Code starts for a connected project. It talks over stdio and opens no port. */
export async function runMcpServer(projectDir: string) {
  const store = await Store.open();
  const project: Project = (await projectForDir(store, projectDir)) ?? (await addProject(store, projectDir));

  const server = new McpServer({ name: "fivebar", version: "0.1.0" });

  server.registerTool(
    "get_findings",
    {
      description: "List Fivebar's security findings for this project. Defaults to open findings. Each has an id, severity, file:line, a suggested fix and the tools that found it.",
      inputSchema: {
        severity: z.enum(["critical", "high", "medium", "low"]).optional().describe("Only this severity"),
        file: z.string().optional().describe("Only findings in this repo-relative file"),
        status: z.enum(["open", "fixed", "false_positive", "accepted"]).optional().describe("Defaults to open"),
      },
    },
    async ({ severity, file, status }) => {
      let list = await store.listFindings(project.id, { status: status ?? "open" });
      if (severity) list = list.filter((f) => f.severity === severity);
      if (file) list = list.filter((f) => f.file === file.replace(/\\/g, "/"));
      return text({ project: project.name, count: list.length, findings: list.map(brief) });
    },
  );

  server.registerTool(
    "get_finding",
    {
      description: "Full detail for one finding: what each tool said, the code snippet and the fix.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const f = await store.getFinding(project.id, id);
      return text(f ?? `No finding with id ${id}`);
    },
  );

  server.registerTool(
    "rescan",
    {
      description: "Run the free scanners now (Opengrep, Gitleaks, OSV-Scanner). 'changed' checks the files you've changed since the last commit; 'full' checks the whole project.",
      inputSchema: { scope: z.enum(["changed", "full"]).default("changed") },
    },
    async ({ scope }) => {
      const files = scope === "changed" ? await workingTreeChanges(project.path) : undefined;
      const o = await scanProject(store, project, scope === "changed" ? { mode: "changed", files, trigger: "mcp" } : { mode: "full", trigger: "mcp" });
      return text({
        score: o.scan.score,
        openInScope: o.inScope.map(brief),
        newFindings: o.newFindings.map(brief),
        closed: o.closed.map((f) => ({ id: f.id, title: f.title })),
      });
    },
  );

  server.registerTool(
    "mark_fixed",
    {
      description: "Tell Fivebar you fixed a finding. Fivebar re-scans the file and only closes the finding if the scanners no longer report it.",
      inputSchema: { id: z.string(), note: z.string().optional().describe("What you changed") },
    },
    async ({ id, note }) => {
      const f = await store.getFinding(project.id, id);
      if (!f) return text(`No finding with id ${id}`);
      const o = await scanProject(store, project, f.kind === "dependency" ? { mode: "full", trigger: "mcp" } : { mode: "changed", files: [f.file], trigger: "mcp" });
      const closed = o.closed.some((c) => c.id === id);
      await store.addEvent(project.id, "agent-mark-fixed", `Agent reported a fix for "${f.title}"${closed ? ", confirmed by re-scan" : ", but it is still reported"}`, { id, note });
      return text(closed
        ? { id, closed: true, message: "Re-scan is clean. Finding closed." }
        : { id, closed: false, message: "The scanners still report this. It stays open.", stillOpen: o.inScope.filter((x) => x.id === id).map(brief) });
    },
  );

  server.registerTool(
    "get_loop",
    {
      description: "The current Fivebar agent loop for this project: which round it is on and what was sent back.",
      inputSchema: {},
    },
    async () => {
      const loops = await store.listLoops(project.id, 1);
      return text(loops[0] ? { status: loops[0].status, rounds: loops[0].rounds.length, cap: project.settings.roundCap, lastMessage: loops[0].rounds.at(-1)?.message } : "No agent loop yet.");
    },
  );

  await server.connect(new StdioServerTransport());
}
