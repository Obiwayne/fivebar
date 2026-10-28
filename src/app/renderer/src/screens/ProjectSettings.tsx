import { useEffect, useState } from "react";
import { api, type Connection, type Severity } from "../api";
import type { Ctx } from "../main";
import { Crumbs, useProject } from "./common";

interface Planned { part: keyof Connection; file: string; description: string; diff: string }

const PART_LABEL: Record<keyof Connection, string> = {
  prePush: "Git pre-push hook",
  stopHook: "Claude Code Stop hook",
  claudeMcp: "Claude Code MCP server",
  findingsFile: "Findings file (Codex and others)",
};

export function ProjectSettings({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data, load } = useProject(pid);
  const [conn, setConn] = useState<{ actual: Connection; plan: Planned[]; hooksBlockedBy: string | null } | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({ prePush: true, stopHook: true, claudeMcp: true, findingsFile: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`projects/${pid}/connection`).then(setConn); }, [pid]);
  if (!data) return <div className="empty">Loading…</div>;

  async function doConnect() {
    setBusy(true);
    try {
      const parts = Object.entries(pick).filter(([, v]) => v).map(([k]) => k);
      await api(`projects/${pid}/connect`, { method: "POST", body: { parts } });
      setConn(await api(`projects/${pid}/connection`));
      await load();
      ctx.toast("Connected");
    } catch (e) {
      ctx.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function doDisconnect() {
    setBusy(true);
    try {
      await api(`projects/${pid}/disconnect`, { method: "POST" });
      setConn(await api(`projects/${pid}/connection`));
      await load();
      ctx.toast("Disconnected. Your files were put back.");
    } finally {
      setBusy(false);
    }
  }
  async function setBlock(sev: Severity) {
    const blockOn = data!.settings.blockOn.includes(sev) ? data!.settings.blockOn.filter((s) => s !== sev) : [...data!.settings.blockOn, sev];
    await api(`projects/${pid}`, { method: "PATCH", body: { settings: { blockOn } } });
    await load();
  }
  async function remove() {
    if (!window.confirm?.(`Remove ${data!.name} from Fivebar? Your code is not touched.`)) return;
    await api(`projects/${pid}/disconnect`, { method: "POST" }).catch(() => {});
    await api(`projects/${pid}`, { method: "DELETE" });
    await ctx.reload();
    ctx.go("");
  }

  return (
    <>
      <div className="col" style={{ gap: 4 }}>
        <Crumbs items={[data.name, "Project settings"]} />
        <h1>Project settings</h1>
        <div className="muted" style={{ fontSize: 13 }}>Anything you don't change here follows the main Settings.</div>
      </div>
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <div className="col grow" style={{ minWidth: 460 }}>
          <div className="card col" style={{ gap: 12 }}>
            <h2>Source</h2>
            <div className="row" style={{ justifyContent: "space-between", gap: 12 }}><span>Folder</span><span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{data.path}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Branch</span><span className="mono" style={{ fontSize: 12 }}>{data.branch || "not a git repo"}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Languages</span><span style={{ fontSize: 13 }}>{data.detected.languages.join(", ") || "none found"}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Tests</span><span className="mono" style={{ fontSize: 12 }}>{data.detected.testCommand ?? "none found"}</span></div>
            <div className="row" style={{ justifyContent: "space-between", gap: 12 }}><span>Paths to skip</span><span className="mono" style={{ fontSize: 12, textAlign: "right" }}>{data.settings.skipPaths.join(", ")}</span></div>
          </div>
          <div className="card col" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h2>Connection</h2>
              <span className="muted" style={{ fontSize: 12 }}>Each change is shown before it's written. Backups are saved.</span>
            </div>
            {conn?.hooksBlockedBy && (
              <div className="col" style={{ gap: 4, padding: "12px 14px", borderRadius: 10, background: "var(--amber-soft)", fontSize: 13 }}>
                <b style={{ fontWeight: 500, color: "var(--amber)" }}>Claude Code has hooks turned off</b>
                <span>"disableAllHooks" is on in <span className="mono" style={{ fontSize: 12 }}>{conn.hooksBlockedBy}</span>, so the Stop hook won't run and findings won't go back to the agent. The MCP server and the pre-push hook still work. To use the loop, turn hooks back on in that file.</span>
              </div>
            )}
            {!data.detected.git &&<div style={{ color: "var(--amber)", fontSize: 13 }}>This folder is not a git repo, so the pre-push hook can't be installed.</div>}
            {conn?.plan.map((c) => {
              const on = conn.actual[c.part];
              return (
                <label key={c.part} className="col" style={{ gap: 6, padding: "10px 0", borderTop: "1px solid var(--hairline)", cursor: "pointer" }}>
                  <div className="row" style={{ alignItems: "center", gap: 10 }}>
                    <input type="checkbox" id={`conn-${c.part}`} checked={!!pick[c.part]} onChange={(e) => setPick({ ...pick, [c.part]: e.target.checked })} />
                    <span className="grow" style={{ fontWeight: 500 }}>{PART_LABEL[c.part]}</span>
                    <span className="mono" style={{ fontSize: 11, color: on ? "var(--pass)" : "var(--graphite)" }}>{on ? "CONNECTED" : "OFF"}</span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{c.description}</span>
                  <pre className="block" style={{ background: "var(--pass-soft)" }}>{c.file}{"\n"}{c.diff}</pre>
                </label>
              );
            })}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" disabled={busy || !Object.values(pick).some(Boolean)} onClick={doConnect}>{busy ? "Working…" : "Connect selected"}</button>
              <button className="btn" disabled={busy} onClick={doDisconnect}>Disconnect all</button>
            </div>
          </div>
        </div>
        <div className="col grow" style={{ minWidth: 380 }}>
          <div className="card col" style={{ gap: 14 }}>
            <h2>What stops a push</h2>
            <div className="chips">
              {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
                <button key={s} className={`chip ${data.settings.blockOn.includes(s) ? "on" : ""}`} onClick={() => setBlock(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>The pre-push hook blocks on these severities in the files and commits you push. git push --no-verify skips the check, and Fivebar has no record of it.</div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Rounds before asking you</span><span className="mono">{data.settings.roundCap}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Agent loop sends back</span><span style={{ fontSize: 13 }}>{data.settings.loopOn.join(", ")}</span></div>
          </div>
          <div className="card col" style={{ gap: 14, boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--signal) 35%, transparent)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div className="col" style={{ gap: 3 }}><b style={{ fontWeight: 500 }}>Remove project</b><span className="muted" style={{ fontSize: 13 }}>Disconnects and deletes its history from Fivebar. Your code is not touched.</span></div>
              <button className="btn danger" onClick={remove}>Remove…</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
