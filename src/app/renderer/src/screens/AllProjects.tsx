import { useState } from "react";
import { api, type ProjectSummary } from "../api";
import type { Ctx } from "../main";
import { Dialog, timeAgo } from "../ui";

function GateGlyph({ p }: { p: ProjectSummary }) {
  // A small picture of the open counts: one bar per severity band plus two for the scanners' coverage.
  const c = p.openCounts;
  const bars = [
    c.critical ? 0.2 : 1,
    c.high ? Math.max(0.2, 1 - c.high * 0.2) : 1,
    c.medium ? Math.max(0.3, 1 - c.medium * 0.1) : 1,
    c.low ? Math.max(0.5, 1 - c.low * 0.05) : 1,
    p.lastScan ? 1 : 0,
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 120 }}>
      {bars.map((v, i) => (
        <div key={i} style={{ height: 5, borderRadius: 2, background: "var(--hairline)", overflow: "hidden" }}>
          <div style={{ width: `${v * 100}%`, height: 5, background: v < 1 && i < 2 ? "var(--signal)" : "var(--ink)" }} />
        </div>
      ))}
    </div>
  );
}

function Tile({ p, ctx }: { p: ProjectSummary; ctx: Ctx }) {
  const blocked = p.openCounts.critical + p.openCounts.high > 0;
  const status = !p.lastScan ? ["NOT SCANNED", "soon"] : p.loop?.status === "needs_owner" ? ["NEEDS YOU", "hot"] : p.loop?.status === "running" ? [`ROUND ${p.loop.rounds.length}/${p.settings.roundCap}`, "warn"] : blocked ? ["PUSH BLOCKED", "hot"] : ["PASSING", "ok"];
  const badge = { hot: { background: "var(--signal)", color: "#fff" }, warn: { background: "var(--amber-soft)", color: "var(--amber)" }, ok: { background: "var(--pass-soft)", color: "var(--pass)" }, soon: { background: "var(--sunken)", color: "var(--graphite)" } }[status[1]];
  return (
    <button className="card" onClick={() => ctx.go(`p/${p.id}`)} style={{ border: 0, textAlign: "left", display: "flex", flexDirection: "column", gap: 14, boxShadow: status[1] === "hot" ? "inset 0 0 0 1.5px var(--signal)" : undefined }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 500 }}>{p.name}</div>
          <div className="mono muted" style={{ fontSize: 11, wordBreak: "break-all" }}>{p.path}</div>
        </div>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", padding: "4px 8px", borderRadius: 4, whiteSpace: "nowrap", ...badge }}>{status[0]}</span>
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="num" style={{ fontSize: 72, fontWeight: 300, letterSpacing: "-0.05em", lineHeight: 0.9, color: blocked ? "var(--signal)" : undefined }}>{p.score ?? "–"}</div>
        <GateGlyph p={p} />
      </div>
      <div className="row mono muted" style={{ fontSize: 11, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
        <span style={{ color: p.openCounts.high + p.openCounts.critical ? "var(--signal)" : undefined }}>{p.openCounts.critical + p.openCounts.high} HIGH</span>
        <span>{p.openCounts.medium} MED</span>
        <span style={{ marginLeft: "auto" }}>{p.lastScan ? `${p.lastScan.trigger.toUpperCase()} · ${timeAgo(p.lastScan.finishedAt).toUpperCase()}` : "NO SCANS YET"}</span>
      </div>
    </button>
  );
}

export function AddProjectDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      setBusy("Adding…");
      const { project } = await api<{ project: ProjectSummary }>("projects", { method: "POST", body: { path: folder.trim() } });
      setBusy("Running the first scan…");
      await api(`projects/${project.id}/scan`, { method: "POST" });
      await ctx.reload();
      ctx.toast(`Added ${project.name}`);
      onClose();
      ctx.go(`p/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  return (
    <Dialog onClose={onClose}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 22 }}>Add a project</h2>
        <span className="label">Local folder</span>
      </div>
      <input type="text" id="add-folder" placeholder={"F:\\RepoQuarry-Builds\\my-app"} value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && folder && add()} autoFocus className="mono" />
      <div className="muted" style={{ fontSize: 13 }}>
        Fivebar runs Opengrep, Gitleaks and OSV-Scanner over the folder. Nothing is changed in the project until you connect it to Claude Code or git in Project settings.
      </div>
      {error && <div style={{ color: "var(--signal)", fontSize: 13 }}>{error}</div>}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: "1px solid var(--hairline)" }}>
        <span className="muted" style={{ fontSize: 12 }}>{busy ?? "The first scan usually takes under a minute."}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!folder.trim() || !!busy} onClick={add}>Add and scan</button>
        </div>
      </div>
    </Dialog>
  );
}

export function AllProjects({ ctx }: { ctx: Ctx }) {
  const [adding, setAdding] = useState(false);
  const { projects } = ctx.state;
  const blocked = projects.filter((p) => p.openCounts.critical + p.openCounts.high > 0).length;
  const looping = projects.filter((p) => p.loop?.status === "running" || p.loop?.status === "needs_owner").length;
  return (
    <>
      <div className="head">
        <div className="col" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 40 }}>All projects</h1>
          <div className="muted">{projects.length} project{projects.length === 1 ? "" : "s"} · {blocked} with pushes blocked · {looping} with an agent loop open</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add project</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {projects.map((p) => <Tile key={p.id} p={p} ctx={ctx} />)}
        <button onClick={() => setAdding(true)} style={{ border: "1.5px dashed #cfccc2", borderRadius: 20, background: "none", minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 300 }}>+</span>
          <span style={{ fontWeight: 500 }}>Add a project</span>
          <span className="muted" style={{ fontSize: 13 }}>Paste a folder path. The first scan usually takes under a minute.</span>
        </button>
      </div>
      {adding && <AddProjectDialog ctx={ctx} onClose={() => setAdding(false)} />}
    </>
  );
}
