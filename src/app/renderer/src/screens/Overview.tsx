import { useState } from "react";
import { api, type Finding } from "../api";
import type { Ctx } from "../main";
import { Agree, Icon, SeverityBadge, Sparkline, ToolBadges, timeAgo, where } from "../ui";
import { bySeverity, Crumbs, useFindings, useProject } from "./common";
import { LoopTimeline } from "./AgentLoop";

export function FindingRow({ f, ctx, pid }: { f: Finding; ctx: Ctx; pid: string }) {
  return (
    <div className="frow" onClick={() => ctx.go(`p/${pid}/f/${f.id}`)}>
      <div className="c-sev"><SeverityBadge s={f.severity} /></div>
      <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div className="ftitle">{f.title}</div>
        <div className="fwhere">{where(f)}{f.cwe ? ` · ${f.cwe}` : ""}</div>
      </div>
      <div className="c-tools"><ToolBadges f={f} /></div>
      <div className="c-agree"><Agree n={new Set(f.tools.map((t) => t.tool)).size} /></div>
      <div className="c-act"><button className={`btn small ${f.severity === "high" || f.severity === "critical" ? "primary" : ""}`}>Open</button></div>
    </div>
  );
}

export function FindingsHead() {
  return (
    <div className="table-head label" style={{ fontSize: 10 }}>
      <div className="c-sev">Severity</div><div className="grow">Finding</div><div className="c-tools">Tools</div><div className="c-agree">Agree</div><div className="c-act" />
    </div>
  );
}

export function Overview({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data, load } = useProject(pid);
  const { list, load: loadFindings } = useFindings(pid, "open");
  const [scanning, setScanning] = useState(false);
  if (!data) return <div className="empty">Loading…</div>;
  const c = data.openCounts;
  const trend = data.trend.map((t) => t.score);
  const week = trend.length > 1 ? trend[trend.length - 1] - trend[0] : 0;

  async function scan() {
    setScanning(true);
    try {
      const r = await api<{ newCount: number; closedCount: number }>(`projects/${pid}/scan`, { method: "POST" });
      ctx.toast(`Scan done: ${r.newCount} new, ${r.closedCount} closed`);
      await Promise.all([load(), loadFindings(), ctx.reload()]);
    } catch (e) {
      ctx.toast((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const open = [...(list ?? [])].sort(bySeverity);
  return (
    <>
      <div className="head">
        <div className="col" style={{ gap: 4 }}>
          <Crumbs items={["Projects", data.name]} />
          <div className="row wrap" style={{ alignItems: "center", gap: 12 }}>
            <h1>{data.name}</h1>
            {data.branch && <span className="pill">{data.branch}{data.head ? ` · ${data.head}` : ""}</span>}
            <span className="muted" style={{ fontSize: 13 }}>
              {data.lastScan ? `Last scan: ${data.lastScan.trigger} · ${timeAgo(data.lastScan.finishedAt)} · ${((Date.parse(data.lastScan.finishedAt) - Date.parse(data.lastScan.startedAt)) / 1000).toFixed(1)} s` : "Not scanned yet"}
            </span>
          </div>
        </div>
        <button className="btn primary" disabled={scanning} onClick={scan} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="refresh" size={14} /> {scanning ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {!scanning && data.lastScan?.tools.some((t) => !t.ok) && (
        <div className="card row" style={{ alignItems: "baseline", gap: 14, padding: "14px 20px", background: "var(--amber-soft)" }}>
          <div style={{ fontWeight: 500, color: "var(--amber)" }}>The last scan is incomplete</div>
          <div className="mono" style={{ fontSize: 12 }}>
            {data.lastScan.tools.filter((t) => !t.ok).map((t) => `${t.tool}: ${(t.error ?? "failed").trim().split("\n").pop()}`).join(" · ")}
          </div>
        </div>
      )}

      {scanning && (
        <div className="card dark row" style={{ alignItems: "center", gap: 18, padding: "14px 20px" }}>
          <div style={{ fontWeight: 500 }}>Full scan running</div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.6 }}>OPENGREP · GITLEAKS · OSV-SCANNER</div>
        </div>
      )}

      <div className="row wrap">
        <div className="card col" style={{ width: 340, flexShrink: 0, gap: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="label">Project score</span>
            {trend.length > 1 && (
              <span className="mono" style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: week >= 0 ? "var(--pass-soft)" : "var(--signal-soft)", color: week >= 0 ? "var(--pass)" : "var(--signal)" }}>
                {week >= 0 ? "+" : ""}{week} SINCE FIRST SCAN
              </span>
            )}
          </div>
          <div className="row" style={{ alignItems: "flex-end", gap: 10 }}>
            <div className="score-big num">{data.score ?? "–"}</div>
            <div className="muted" style={{ fontSize: 16, paddingBottom: 12 }}>/ 100</div>
          </div>
          <Sparkline points={trend} />
          <div className="label" style={{ fontSize: 10 }}>{data.scans.length} scan{data.scans.length === 1 ? "" : "s"}</div>
        </div>
        <div className="col grow" style={{ minWidth: 420 }}>
          <div className="row">
            <div className="tile"><span className="label">Critical</span><span className="big num" style={{ color: c.critical ? undefined : "var(--graphite)" }}>{c.critical}</span></div>
            <div className={`tile ${c.high ? "hot" : ""}`}>
              <div className="row" style={{ justifyContent: "space-between" }}><span className="label" style={{ color: c.high ? "var(--signal)" : undefined }}>High</span>{c.high > 0 && data.settings.blockOn.includes("high") && <span className="label" style={{ color: "var(--signal)" }}>Blocks push</span>}</div>
              <span className="big num">{c.high}</span>
            </div>
            <div className="tile"><span className="label" style={{ color: "var(--amber)" }}>Medium</span><span className="big num">{c.medium}</span></div>
            <div className="tile"><span className="label">Low</span><span className="big num">{c.low}</span></div>
          </div>
          <div className="card dark row" style={{ alignItems: "center", gap: 28 }}>
            <div className="col" style={{ gap: 6, width: 200, flexShrink: 0 }}>
              <span className="label" style={{ color: "#8e8c84" }}>Connection</span>
              <div style={{ fontSize: 20, fontWeight: 500 }}>{Object.values(data.connection).filter(Boolean).length} of 4 connected</div>
              <button className="btn small" style={{ background: "transparent", color: "inherit", borderColor: "#3a3936", width: "fit-content" }} onClick={() => ctx.go(`p/${pid}/settings`)}>Project settings</button>
            </div>
            <div className="bars grow">
              {([
                ["Pre-push hook", data.connection.prePush],
                ["Claude Code Stop hook", data.connection.stopHook],
                ["MCP server", data.connection.claudeMcp],
                ["Findings file", data.connection.findingsFile],
              ] as const).map(([name, on]) => (
                <div key={name} className="bar-row" style={{ color: on ? "var(--on-ink)" : "#5e5d58" }}>
                  <span className="name" style={{ width: 160 }}>{name}</span>
                  <div className="bar"><div style={{ width: on ? "100%" : "0%" }} /></div>
                  <span className="mono" style={{ width: 34, fontSize: 11, textAlign: "right" }}>{on ? "ON" : "OFF"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ alignItems: "stretch" }}>
        <div className="card grow col" style={{ gap: 0, minWidth: 520 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", paddingBottom: 14 }}>
            <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
              <h2>Open findings</h2>
              <span className="muted" style={{ fontSize: 13 }}>{open.length} open{data.lastScan ? ` · last scan found ${data.lastScan.tools.reduce((a, t) => a + t.count, 0)} tool results` : ""}</span>
            </div>
            <button className="btn small" onClick={() => ctx.go(`p/${pid}/findings`)}>View all</button>
          </div>
          <FindingsHead />
          {open.slice(0, 6).map((f) => <FindingRow key={f.id} f={f} ctx={ctx} pid={pid} />)}
          {!open.length && <div className="empty">{data.lastScan ? "No open findings. Nice." : "Run a scan to see findings."}</div>}
        </div>
        <div className="card col" style={{ width: 340, flexShrink: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2>Agent loop</h2>
            {data.loop && <span className="label">{data.loop.agent} · {data.loop.status.replace("_", " ")}</span>}
          </div>
          {data.loop ? <LoopTimeline loop={data.loop} cap={data.settings.roundCap} compact /> : <div className="muted" style={{ fontSize: 13 }}>No agent loop yet. Connect Claude Code in Project settings, and Fivebar checks every turn the agent finishes.</div>}
          <button className="btn small" style={{ marginTop: "auto", width: "fit-content" }} onClick={() => ctx.go(`p/${pid}/loop`)}>Open agent loop</button>
        </div>
      </div>
    </>
  );
}
