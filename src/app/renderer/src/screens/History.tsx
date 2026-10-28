import type { Ctx } from "../main";
import { Crumbs, useProject } from "./common";

const KIND_STYLE: Record<string, { label: string; color?: string }> = {
  scan: { label: "Scan" },
  "push-blocked": { label: "Push blocked", color: "var(--signal)" },
  "push-checked": { label: "Push checked", color: "var(--pass)" },
  "loop-round": { label: "Agent loop" },
  "loop-passed": { label: "Agent loop", color: "var(--pass)" },
  "loop-needs-owner": { label: "Needs you", color: "var(--signal)" },
  review: { label: "Review gate" },
  "finding-false_positive": { label: "Dismissed", color: "var(--amber)" },
  "finding-accepted": { label: "Risk accepted", color: "var(--amber)" },
  "finding-open": { label: "Reopened" },
  "agent-mark-fixed": { label: "Agent fix" },
  connect: { label: "Connected" },
  disconnect: { label: "Disconnected" },
  project: { label: "Project" },
  "risk-expired": { label: "Risk expired", color: "var(--amber)" },
};

function Chart({ points }: { points: { at: string; score: number }[] }) {
  const W = 1000, H = 200;
  if (points.length < 2) return <div className="muted" style={{ fontSize: 13, padding: "40px 0" }}>The chart appears after two scans.</div>;
  const t0 = Date.parse(points[0].at), t1 = Date.parse(points[points.length - 1].at) || t0 + 1;
  const x = (at: string) => ((Date.parse(at) - t0) / Math.max(1, t1 - t0)) * (W - 40) + 4;
  const y = (s: number) => H - 14 - (s / 100) * (H - 30);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-label="Score over time">
      {[100, 80, 60].map((v) => (
        <g key={v}>
          <line x1="0" x2={W - 30} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
          <text x={W - 26} y={y(v) + 4} fontSize="11" fill="var(--graphite)" fontFamily="var(--mono)">{v}</text>
        </g>
      ))}
      <path d={`${d} L${x(points[points.length - 1].at)} ${H - 14} L${x(points[0].at)} ${H - 14} Z`} fill="var(--ink)" fillOpacity="0.05" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(p.at)} cy={y(p.score)} r="3.5" fill="var(--ink)" />)}
    </svg>
  );
}

export function History({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data } = useProject(pid);
  if (!data) return <div className="empty">Loading…</div>;
  const first = data.trend[0]?.score;
  void ctx;
  return (
    <>
      <div className="col" style={{ gap: 4 }}>
        <Crumbs items={[data.name, "History"]} />
        <h1>History</h1>
        <div className="muted" style={{ fontSize: 13 }}>Every scan, push, agent loop, review and dismissal for this project.</div>
      </div>
      <div className="card col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 28, alignItems: "flex-end" }}>
          <div className="col" style={{ gap: 2 }}><span className="label">Score now</span><span className="num" style={{ fontSize: 44, fontWeight: 300 }}>{data.score ?? "–"}</span></div>
          <div className="col" style={{ gap: 2 }}><span className="label">First scan</span><span className="num muted" style={{ fontSize: 44, fontWeight: 300 }}>{first ?? "–"}</span></div>
        </div>
        <Chart points={data.trend} />
      </div>
      <div className="card" style={{ paddingTop: 6 }}>
        <div className="table-head label" style={{ fontSize: 10 }}>
          <div style={{ width: 150 }}>When</div><div style={{ width: 130 }}>What</div><div className="grow">What happened</div>
        </div>
        {data.events.map((e) => {
          const k = KIND_STYLE[e.kind] ?? { label: e.kind };
          return (
            <div key={e.id} className="row" style={{ padding: "11px 0", borderTop: "1px solid var(--hairline)", gap: 14, alignItems: "baseline" }}>
              <div className="mono" style={{ width: 150, flexShrink: 0, fontSize: 12 }}>{new Date(e.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              <div style={{ width: 130, flexShrink: 0, fontSize: 13, color: k.color }}>{k.label}</div>
              <div className="grow" style={{ fontSize: 13 }}>{e.text}{e.data?.reason ? ` · "${e.data.reason}"` : ""}</div>
              {e.data?.score !== undefined && <div className="mono" style={{ fontSize: 12 }}>{e.data.score}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
