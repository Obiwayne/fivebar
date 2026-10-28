import { useEffect, useState } from "react";
import { api, type Finding } from "../api";
import type { Ctx } from "../main";
import { Dialog, SeverityBadge, timeAgo, where } from "../ui";
import { Crumbs, useProject } from "./common";

function DismissDialog({ f, pid, ctx, onClose, onDone }: { f: Finding; pid: string; ctx: Ctx; onClose: () => void; onDone: (f: Finding) => void }) {
  const [kind, setKind] = useState<"false_positive" | "accepted">("false_positive");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      const updated = await api<Finding>(`projects/${pid}/findings/${f.id}/status`, { method: "POST", body: { status: kind, reason } });
      ctx.toast(kind === "false_positive" ? "Marked false positive" : "Risk accepted for 30 days");
      onDone(updated);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const agree = new Set(f.tools.map((t) => t.tool)).size;
  return (
    <Dialog onClose={onClose}>
      <div className="col" style={{ gap: 6 }}>
        <h2 style={{ fontSize: 22 }}>Dismiss this finding?</h2>
        <div className="muted">{f.title} · {where(f)}{agree > 1 ? `. Confirmed by ${agree} tools, so be sure.` : ""}</div>
      </div>
      <div className="seg">
        <button className={kind === "false_positive" ? "on" : ""} onClick={() => setKind("false_positive")}>False positive</button>
        <button className={kind === "accepted" ? "on" : ""} onClick={() => setKind("accepted")}>Accept the risk</button>
      </div>
      <label className="col" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Why? (required)</span>
        <textarea id="dismiss-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <div className="muted" style={{ fontSize: 12 }}>
        {kind === "accepted" ? "Accepted risks expire after 30 days and come back for review." : "The same finding stays dismissed in future scans."} Every dismissal is logged in History.
      </div>
      {error && <div style={{ color: "var(--signal)", fontSize: 13 }}>{error}</div>}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!reason.trim()} onClick={save}>{kind === "false_positive" ? "Mark false positive" : "Accept risk"}</button>
      </div>
    </Dialog>
  );
}

export function FindingDetail({ ctx, pid, fid }: { ctx: Ctx; pid: string; fid: string }) {
  const { data } = useProject(pid);
  const [f, setF] = useState<Finding | null>(null);
  const [src, setSrc] = useState<{ from: number; lines: string[] } | null>(null);
  const [dismiss, setDismiss] = useState(false);
  useEffect(() => {
    api<Finding>(`projects/${pid}/findings/${fid}`).then(setF);
    api<{ from: number; lines: string[] }>(`projects/${pid}/findings/${fid}/source`).then(setSrc);
  }, [pid, fid]);
  if (!f) return <div className="empty">Loading…</div>;

  async function reopen() {
    const u = await api<Finding>(`projects/${pid}/findings/${f!.id}/status`, { method: "POST", body: { status: "open" } });
    setF(u);
    ctx.toast("Reopened");
  }

  const agent = `Fix this finding from Fivebar.\n\n${f.severity.toUpperCase()}: ${f.title}\nWhere: ${where(f)}${f.cwe ? ` (${f.cwe})` : ""}\n${f.fix ? `Fix: ${f.fix}\n` : ""}Finding id: ${f.id}\n\nWhen done, call the fivebar mark_fixed tool with this id.`;
  async function copyForAgent() {
    try {
      await navigator.clipboard.writeText(agent);
      ctx.toast("Copied. Paste it into Claude Code or Codex.");
    } catch {
      ctx.toast("Could not copy. Select the text in the box instead.");
    }
  }

  return (
    <>
      <div className="col" style={{ gap: 10 }}>
        <Crumbs items={[data?.name ?? ctx.state.projects.find((p) => p.id === pid)?.name ?? "…", "Findings", f.id]} />
        <div className="head" style={{ alignItems: "center" }}>
          <div className="row" style={{ alignItems: "center", gap: 14 }}>
            <SeverityBadge s={f.severity} />
            <h1 style={{ margin: 0 }}>{f.title}</h1>
          </div>
          <div className="chips">
            {f.cwe && <span className="pill">{f.cwe}</span>}
            <span className="pill">{f.status.replace("_", " ").toUpperCase()}</span>
            <span className="pill" style={{ background: "var(--ink)", color: "var(--on-ink)" }}>FOUND BY {new Set(f.tools.map((t) => t.tool)).size} TOOL{new Set(f.tools.map((t) => t.tool)).size > 1 ? "S" : ""}</span>
          </div>
        </div>
      </div>
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <div className="col grow" style={{ minWidth: 480, flex: 1.25 }}>
          {f.kind === "dependency" ? (
            <div className="card col" style={{ gap: 8 }}>
              <span className="label">Dependency</span>
              <div className="mono" style={{ fontSize: 18 }}>{f.dependency?.name}@{f.dependency?.version}</div>
              <div className="muted">In <span className="mono">{f.file}</span>. Advisory {f.dependency?.vulnId}{f.dependency?.aliases.length ? ` (also ${f.dependency.aliases.filter((a) => a !== f.dependency?.vulnId).join(", ")})` : ""}.</div>
              {f.dependency?.fixedIn && <div>Fixed in <b className="mono">{f.dependency.fixedIn}</b></div>}
            </div>
          ) : (
            <div className="code">
              <div className="row mono" style={{ justifyContent: "space-between", padding: "0 20px 12px", borderBottom: "1px solid #2a2a27", fontSize: 12 }}>
                <span>{f.file}</span><span style={{ color: "#8e8c84" }}>{f.startLine ? `LINE ${f.startLine}` : ""}</span>
              </div>
              <div style={{ paddingTop: 12 }}>
                {f.kind === "secret" ? (
                  <div className="ln hit"><span>{f.startLine}</span><span>{f.snippet}   (value hidden)</span></div>
                ) : (
                  src?.lines.map((l, i) => {
                    const n = src.from + i;
                    return <div key={n} className={`ln ${n >= f.startLine && n <= (f.endLine || f.startLine) ? "hit" : ""}`}><span>{n}</span><span>{l}</span></div>;
                  })
                )}
              </div>
            </div>
          )}
          <div className="card">
            <h2 style={{ paddingBottom: 10 }}>What each tool said</h2>
            {f.tools.map((t) => (
              <div key={t.tool + t.ruleId} className="row" style={{ padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
                <div style={{ width: 110, flexShrink: 0 }}><span className="tool">{t.tool}</span></div>
                <div className="grow muted" style={{ fontSize: 13 }}>{t.message}<div className="mono" style={{ fontSize: 11, paddingTop: 4 }}>{t.ruleId}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="col grow" style={{ minWidth: 340 }}>
          <div className="card col" style={{ gap: 12 }}>
            <h2>Suggested fix</h2>
            <div>{f.fix ?? "No fix suggestion from the tools for this one."}</div>
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <h2>What next</h2>
            {f.status === "open" ? (
              <>
                <button className="card dark" style={{ border: 0, textAlign: "left", padding: "12px 16px", borderRadius: 12 }} onClick={copyForAgent}>
                  <div style={{ fontWeight: 500 }}>Send to agent</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Copies a ready-made prompt. A connected Claude Code also gets it at the end of its next turn.</div>
                </button>
                <pre className="block" style={{ maxHeight: 120, overflow: "auto" }}>{agent}</pre>
                <button className="btn" onClick={() => setDismiss(true)}>False positive or accept risk…</button>
              </>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 13 }}>{f.status === "fixed" ? `Fixed ${timeAgo(f.fixedAt)}. A clean re-scan closed it.` : `Dismissed: ${f.reason ?? ""}`}</div>
                {f.status !== "fixed" && <button className="btn" onClick={reopen}>Reopen</button>}
              </>
            )}
          </div>
          <div className="card col" style={{ gap: 8 }}>
            <h2>History</h2>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>First found</span><span className="mono muted">{new Date(f.firstSeen).toLocaleString()}</span></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>Last seen</span><span className="mono muted">{new Date(f.lastSeen).toLocaleString()}</span></div>
            {f.expiresAt && <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>Risk accepted until</span><span className="mono muted">{new Date(f.expiresAt).toLocaleDateString()}</span></div>}
          </div>
        </div>
      </div>
      {dismiss && <DismissDialog f={f} pid={pid} ctx={ctx} onClose={() => setDismiss(false)} onDone={setF} />}
    </>
  );
}
