import type { Loop } from "../api";
import type { Ctx } from "../main";
import { timeAgo } from "../ui";
import { Crumbs, useProject } from "./common";

export function LoopTimeline({ loop, cap, compact = false }: { loop: Loop; cap: number; compact?: boolean }) {
  const rounds = loop.rounds;
  const done = loop.status === "passed";
  return (
    <div className="col" style={{ gap: 0 }}>
      {rounds.map((r, i) => {
        const last = i === rounds.length - 1;
        const failedOut = last && loop.status === "needs_owner";
        return (
          <div key={r.at} className="row" style={{ gap: 14 }}>
            <div className="col" style={{ alignItems: "center", width: 22, flexShrink: 0, gap: 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--mono)", fontSize: 11, background: failedOut ? "var(--signal)" : last && !done ? "var(--surface)" : "var(--ink)", color: failedOut ? "#fff" : last && !done ? "var(--signal)" : "var(--on-ink)", border: last && !done && !failedOut ? "2px solid var(--signal)" : 0 }}>{i + 1}</div>
              <div style={{ width: 1.5, flex: 1, background: "var(--hairline)", minHeight: 14 }} />
            </div>
            <div className="col grow" style={{ gap: 6, paddingBottom: 18 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b style={{ fontWeight: 500 }}>Round {i + 1}{last && loop.status === "running" ? " · now" : ""}</b>
                <span className="mono muted" style={{ fontSize: 11 }}>{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>Sent {r.findingIds.length} finding{r.findingIds.length === 1 ? "" : "s"} back to the agent.</div>
              {!compact && <pre className="block" style={{ background: "#141414", color: "#c9c7bf" }}>{r.message}</pre>}
            </div>
          </div>
        );
      })}
      <div className="row" style={{ gap: 14 }}>
        <div style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, border: done ? 0 : "1.5px dashed var(--graphite)", background: done ? "var(--pass)" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{done ? "✓" : ""}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {done ? "Clean re-check. The agent finished." : loop.status === "needs_owner" ? `Stopped after ${cap} rounds. Waiting for you. Nothing was pushed.` : `Round ${rounds.length + 1} of ${cap} runs when the agent next finishes.`}
        </div>
      </div>
    </div>
  );
}

export function AgentLoop({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data } = useProject(pid);
  if (!data) return <div className="empty">Loading…</div>;
  const [current, ...past] = data.loops;
  const conn = data.connection;
  return (
    <>
      <div className="head">
        <div className="col" style={{ gap: 4 }}>
          <Crumbs items={[data.name, "Agent loop"]} />
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <h1>{current ? "Latest loop" : "Agent loop"}</h1>
            {current && <span className="mono" style={{ fontSize: 11, padding: "4px 9px", borderRadius: 999, background: current.status === "passed" ? "var(--pass-soft)" : "var(--signal-soft)", color: current.status === "passed" ? "var(--pass)" : "var(--signal)" }}>{current.status === "needs_owner" ? `NEEDS YOU · STOPPED AFTER ROUND ${current.rounds.length}` : current.status === "running" ? `LIVE · ROUND ${current.rounds.length} OF ${data.settings.roundCap}` : "PASSED"}</span>}
          </div>
          {current && <div className="muted" style={{ fontSize: 13 }}>{current.agent} · session {current.sessionId.slice(0, 8)} · started {timeAgo(current.startedAt)}</div>}
        </div>
      </div>
      {current?.status === "needs_owner" && (
        <div className="card row wrap" style={{ alignItems: "center", justifyContent: "space-between", background: "var(--signal-soft)", boxShadow: "inset 0 0 0 1.5px var(--signal)" }}>
          <div className="col" style={{ gap: 3 }}>
            <b style={{ fontWeight: 500 }}>What should happen next?</b>
            <span className="muted" style={{ fontSize: 13 }}>The agent stopped after {data.settings.roundCap} rounds. Look at the open findings, fix them yourself or tell the agent what to change, or dismiss a false positive.</span>
          </div>
          <button className="btn primary" onClick={() => ctx.go(`p/${pid}/findings`)}>Open findings</button>
        </div>
      )}
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <div className="card grow" style={{ minWidth: 480, flex: 1.5 }}>
          {current ? <LoopTimeline loop={current} cap={data.settings.roundCap} /> : <div className="empty">No loop yet. When a connected agent finishes a turn with problems in the files it changed, the rounds appear here.</div>}
        </div>
        <div className="col grow" style={{ minWidth: 320 }}>
          <div className="card col" style={{ gap: 12 }}>
            <h2>How Fivebar reaches the agent</h2>
            {([
              ["MCP server", "get_findings · get_finding · rescan · mark_fixed · get_loop", conn.claudeMcp],
              ["Claude Code Stop hook", ".claude/settings.local.json", conn.stopHook],
              ["Findings file for Codex", ".fivebar/findings.md", conn.findingsFile],
            ] as const).map(([name, sub, on]) => (
              <div key={name} className="row" style={{ alignItems: "center", gap: 12 }}>
                <span className={`dot ${on ? "" : "idle"}`} />
                <div className="col grow" style={{ gap: 2 }}><span>{name}</span><span className="mono muted" style={{ fontSize: 11 }}>{sub}</span></div>
                <span className="mono" style={{ fontSize: 11, color: on ? "var(--pass)" : "var(--graphite)" }}>{on ? "ON" : "OFF"}</span>
              </div>
            ))}
            <button className="btn small" style={{ width: "fit-content" }} onClick={() => ctx.go(`p/${pid}/settings`)}>Change in Project settings</button>
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <h2>Safeguards</h2>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Rounds before asking you</span><span className="mono">{data.settings.roundCap}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>Pre-push hook blocks</span><span className="mono muted" style={{ fontSize: 11 }}>{conn.prePush ? data.settings.blockOn.join(" · ").toUpperCase() : "OFF"}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span>mark_fixed closes a finding</span><span className="mono muted" style={{ fontSize: 11 }}>ONLY AFTER RE-SCAN</span></div>
          </div>
          <div className="card col" style={{ gap: 0 }}>
            <h2 style={{ paddingBottom: 10 }}>Past loops</h2>
            {past.map((l) => (
              <div key={l.sessionId} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", fontSize: 13 }}>
                <span className="grow">{l.status === "passed" ? `Passed after ${l.rounds.length} round${l.rounds.length === 1 ? "" : "s"}` : l.status === "needs_owner" ? `Stopped at round ${l.rounds.length}` : `Running, round ${l.rounds.length}`}</span>
                <span className="mono muted" style={{ fontSize: 11 }}>{timeAgo(l.updatedAt)}</span>
              </div>
            ))}
            {!past.length && <div className="muted" style={{ fontSize: 13 }}>None yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
