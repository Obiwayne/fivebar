import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../main";
import { timeAgo } from "../ui";
import { Crumbs, useProject } from "./common";

const DIMS = ["security", "correctness", "readability", "tests", "maintainability"] as const;
type Dim = (typeof DIMS)[number];
interface DimResult { score: number; aiScore: number | null; reason: string; rubricLine?: string; fix?: string; floor?: { max: number; because: string } }
interface Review {
  id: string; at: string; target: string; files: string[]; passed: boolean; aiError?: string;
  scores: Record<Dim, DimResult>; checks: { name: string; ok: boolean | null; detail: string; durationMs: number }[];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function GateBars({ review, dark = false }: { review: Review; dark?: boolean }) {
  return (
    <div className="bars">
      {DIMS.map((d) => {
        const s = review.scores[d].score;
        return (
          <div key={d} className={`bar-row ${s < 5 ? "fail" : ""}`} style={{ color: s < 5 ? "var(--signal)" : dark ? "var(--on-ink)" : "var(--ink)" }}>
            <span className="name">{cap(d)}</span>
            <div className="bar"><div style={{ width: `${(s / 5) * 100}%` }} /></div>
            <span className="mono" style={{ width: 16, textAlign: "right", fontSize: 12 }}>{s || "–"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewGate({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data } = useProject(pid);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [running, setRunning] = useState(false);
  const load = useCallback(async () => setReviews(await api<Review[]>(`projects/${pid}/reviews`)), [pid]);
  useEffect(() => { load(); }, [load]);

  async function run() {
    setRunning(true);
    try {
      const r = await api<Review>(`projects/${pid}/review`, { method: "POST" });
      ctx.toast(r.passed ? "Gate passed: 5/5" : `Gate shut: ${DIMS.filter((d) => r.scores[d].score === 5).length} of 5 bars at 5`);
      await load();
    } catch (e) {
      ctx.toast((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const r = reviews?.[0];
  const fives = r ? DIMS.filter((d) => r.scores[d].score === 5).length : 0;
  return (
    <>
      <div className="head">
        <div className="col" style={{ gap: 4 }}>
          <Crumbs items={[data?.name ?? ctx.state.projects.find((p) => p.id === pid)?.name ?? "…", "Review gate"]} />
          <h1>Review gate</h1>
          <div className="muted" style={{ fontSize: 13 }}>{r ? `Reviewed ${r.target} · ${r.files.length} file${r.files.length === 1 ? "" : "s"} · ${timeAgo(r.at)}` : "Scores the current change 1 to 5 on five things. All five must be 5."}</div>
        </div>
        <button className="btn primary" disabled={running} onClick={run}>{running ? "Reviewing… (about 30 s)" : r ? "Re-review now" : "Review this change"}</button>
      </div>
      {!r && !running && (
        <div className="card col" style={{ gap: 10 }}>
          <h2>No review yet</h2>
          <div className="muted">The AI reviewer runs once through your Claude Code (claude -p, read-only tools), so it uses 1 Claude job. Your tests and Fivebar's scanners set hard limits it can't score above.</div>
        </div>
      )}
      {r && (
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <div className="card grow col" style={{ gap: 0, minWidth: 520, flex: 1.45 }}>
            <div className="row" style={{ alignItems: "baseline", gap: 16, paddingBottom: 16 }}>
              <div className="num" style={{ fontSize: 64, fontWeight: 300, letterSpacing: "-0.05em", lineHeight: 1 }}>{fives}/5</div>
              <div className="muted" style={{ fontSize: 15 }}>{r.passed ? "bars at 5. The gate is open." : "bars at 5. The gate stays shut."}</div>
            </div>
            {r.aiError && <div style={{ color: "var(--amber)", fontSize: 13, paddingBottom: 10 }}>AI reviewer: {r.aiError}</div>}
            {DIMS.map((d) => {
              const x = r.scores[d];
              const bad = x.score < 5;
              return (
                <div key={d} className="col" style={{ gap: 8, padding: "16px 0", borderTop: "1px solid var(--hairline)", ...(bad ? { background: "var(--signal-soft)", boxShadow: "0 0 0 12px var(--signal-soft)", borderRadius: 4, margin: "6px 0" } : {}) }}>
                  <div className="row" style={{ alignItems: "center", gap: 16 }}>
                    <div style={{ fontSize: 16, fontWeight: 500, width: 140, color: bad ? "var(--signal)" : undefined }}>{cap(d)}</div>
                    <div className="bar grow" style={{ color: bad ? "var(--signal)" : "var(--ink)" }}><div style={{ width: `${(x.score / 5) * 100}%` }} /></div>
                    <div className="num" style={{ fontSize: 24, width: 40, textAlign: "center", color: bad ? "var(--signal)" : undefined }}>{x.score || "–"}</div>
                  </div>
                  <div style={{ fontSize: 13 }}>{x.reason}</div>
                  {x.floor && <div className="mono" style={{ fontSize: 11, color: "var(--signal)" }}>TOOL LIMIT: {x.floor.max}/5 · {x.floor.because}</div>}
                  {bad && x.fix && <div className="mono" style={{ fontSize: 12 }}>fix: {x.fix}</div>}
                </div>
              );
            })}
          </div>
          <div className="col grow" style={{ minWidth: 320 }}>
            <div className="card col" style={{ gap: 2 }}>
              <h2 style={{ paddingBottom: 10 }}>Tool checks on this change</h2>
              {r.checks.map((c) => (
                <div key={c.name} className="col" style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)", gap: 3 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}><span className="mono" style={{ fontSize: 12 }}>{c.name}</span><span className="mono" style={{ fontSize: 11, color: c.ok === null ? "var(--graphite)" : c.ok ? "var(--pass)" : "var(--signal)" }}>{c.ok === null ? "NONE" : c.ok ? "PASS" : "FAIL"}</span></div>
                  <span className="muted" style={{ fontSize: 12 }}>{c.detail}</span>
                </div>
              ))}
              <div className="row" style={{ justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--hairline)" }}><span className="mono" style={{ fontSize: 12 }}>AI reviewer (claude -p)</span><span className="mono muted" style={{ fontSize: 11 }}>{r.aiError ? "DID NOT RUN" : "1 CALL"}</span></div>
            </div>
            <div className="card col" style={{ gap: 6 }}>
              <h2>How the two reviewers combine</h2>
              <div className="muted" style={{ fontSize: 13 }}>A bar is full only when the AI reviewer gives 5 and no tool sets a lower limit. A failing test caps Correctness at 2. An open critical finding caps Security at 1, a high at 2.</div>
            </div>
            {reviews!.length > 1 && (
              <div className="card col" style={{ gap: 0 }}>
                <h2 style={{ paddingBottom: 10 }}>Earlier reviews</h2>
                {reviews!.slice(1, 6).map((x) => (
                  <div key={x.id} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--hairline)", fontSize: 13 }}>
                    <span className="grow">{DIMS.filter((d) => x.scores[d].score === 5).length} of 5 bars</span>
                    <span className="mono muted" style={{ fontSize: 11 }}>{timeAgo(x.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
