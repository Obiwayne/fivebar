import { useMemo, useState } from "react";
import type { Ctx } from "../main";
import { bySeverity, Crumbs, useFindings, useProject } from "./common";
import { FindingRow, FindingsHead } from "./Overview";

const TABS = [
  ["open", "Open"],
  ["fixed", "Fixed"],
  ["false_positive", "False positive"],
  ["accepted", "Accepted risk"],
] as const;

export function Findings({ ctx, pid }: { ctx: Ctx; pid: string }) {
  const { data } = useProject(pid);
  const { list } = useFindings(pid);
  const [tab, setTab] = useState<string>("open");
  const [tool, setTool] = useState<string>("all");
  const [q, setQ] = useState("");
  const all = list ?? [];
  const counts = useMemo(() => Object.fromEntries(TABS.map(([k]) => [k, all.filter((f) => f.status === k).length])), [all]);
  const tools = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of all.filter((x) => x.status === tab)) for (const t of new Set(f.tools.map((x) => x.tool))) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()];
  }, [all, tab]);
  const shown = all
    .filter((f) => f.status === tab)
    .filter((f) => tool === "all" || f.tools.some((t) => t.tool === tool))
    .filter((f) => !q || `${f.title} ${f.file} ${f.cwe ?? ""} ${f.tools.map((t) => t.ruleId).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .sort(bySeverity);

  return (
    <>
      <div className="head">
        <div className="col" style={{ gap: 4 }}>
          <Crumbs items={[data?.name ?? ctx.state.projects.find((p) => p.id === pid)?.name ?? "…", "Findings"]} />
          <h1>Findings</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            Results from every tool, merged. A finding reported by more than one tool shows each tool's badge.
          </div>
        </div>
        <input type="text" id="find-search" placeholder="Search file, rule or CWE" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280, borderRadius: 999 }} />
      </div>
      <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="seg">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label} {counts[k] ?? 0}</button>)}
        </div>
        <div className="chips" style={{ alignItems: "center" }}>
          <span className="label" style={{ paddingRight: 4 }}>Tool</span>
          <button className={`chip mono ${tool === "all" ? "on" : ""}`} onClick={() => setTool("all")}>ALL</button>
          {tools.map(([t, n]) => <button key={t} className={`chip mono ${tool === t ? "on" : ""}`} onClick={() => setTool(t)}>{t.toUpperCase()} {n}</button>)}
        </div>
      </div>
      <div className="card" style={{ paddingTop: 6 }}>
        <FindingsHead />
        {shown.map((f) => <FindingRow key={f.id} f={f} ctx={ctx} pid={pid} />)}
        {!shown.length && <div className="empty">Nothing here.</div>}
      </div>
    </>
  );
}
