import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, type AppState } from "./api";
import { Icon, Shield, sevColor, useToast } from "./ui";
import { AllProjects } from "./screens/AllProjects";
import { Overview } from "./screens/Overview";
import { Findings } from "./screens/Findings";
import { FindingDetail } from "./screens/FindingDetail";
import { AgentLoop } from "./screens/AgentLoop";
import { ReviewGate } from "./screens/ReviewGate";
import { History } from "./screens/History";
import { ProjectSettings } from "./screens/ProjectSettings";
import { Settings } from "./screens/Settings";
import { Setup } from "./screens/Setup";

export interface Ctx {
  state: AppState;
  reload: () => Promise<void>;
  go: (hash: string) => void;
  toast: (msg: string) => void;
}

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

const PROJECT_NAV = [
  ["", "Overview", "grid"],
  ["findings", "Findings", "list"],
  ["loop", "Agent loop", "loop"],
  ["gate", "Review gate", "gate"],
  ["history", "History", "history"],
  ["settings", "Project settings", "sliders"],
] as const;

function Sidebar({ ctx, route }: { ctx: Ctx; route: string[] }) {
  const { projects } = ctx.state;
  const pid = route[0] === "p" ? route[1] : undefined;
  const section = route[0] === "p" ? (route[2] === "f" ? "findings" : route[2] ?? "") : undefined;
  const current = projects.find((p) => p.id === pid);
  const openCount = current ? Object.values(current.openCounts).reduce((a, b) => a + b, 0) : 0;
  return (
    <aside className="sidebar">
      <div>
        <div className="brand"><Shield size={24} /> fivebar</div>
        <nav className="nav">
          <button className={`nav-item ${route.length === 0 ? "active" : ""}`} onClick={() => ctx.go("")}>
            <Icon name="folder" /> All projects <span className="count">{projects.length}</span>
          </button>
          {current && (
            <>
              <div className="nav-sep" />
              <div className="label nav-label">{current.name}</div>
              {PROJECT_NAV.map(([key, label, icon]) => (
                <button key={key} className={`nav-item ${section === key ? "active" : ""}`} onClick={() => ctx.go(`p/${current.id}${key ? `/${key}` : ""}`)}>
                  <Icon name={icon} /> {label}
                  {key === "findings" && <span className="count">{openCount}</span>}
                  {key === "loop" && current.loop?.status === "running" && <span className="dot signal" style={{ marginLeft: "auto" }} />}
                  {key === "loop" && current.loop?.status === "needs_owner" && <span className="dot signal" style={{ marginLeft: "auto" }} />}
                </button>
              ))}
            </>
          )}
          <div className="label nav-label" style={{ marginTop: 16 }}>Projects</div>
          {projects.map((p) => (
            <button key={p.id} className="nav-item" style={p.id === pid ? { background: "var(--sunken)", color: "var(--ink)" } : {}} onClick={() => ctx.go(`p/${p.id}`)}>
              <span className={`dot ${sevColor(p.score)}`} /> {p.name}
              <span className="count" style={{ fontSize: 12 }}>{p.score ?? "–"}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="side-foot">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <span className={`dot ${ctx.state.tools.every((t) => t.installed) ? "" : "signal"}`} />
          {ctx.state.tools.filter((t) => t.installed).length} of {ctx.state.tools.length} scanners ready
        </div>
        <button className={`nav-item ${route[0] === "settings" ? "active" : ""}`} style={{ padding: "6px 8px", fontSize: 12 }} onClick={() => ctx.go("settings")}>
          <Icon name="gear" size={14} /> Settings
        </button>
      </div>
    </aside>
  );
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, toast] = useToast();
  const route = useRoute();
  const reload = useCallback(async () => {
    try {
      setState(await api<AppState>("state"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000); // hooks and the MCP server change data from other processes
    return () => clearInterval(t);
  }, [reload]);

  if (error && !state) return <div className="empty">Fivebar could not reach its local service: {error}</div>;
  if (!state) return <div className="empty">Loading…</div>;
  const ctx: Ctx = { state, reload, go: (h) => (location.hash = `#/${h}`), toast };

  if (!state.settings.setupDone || route[0] === "setup") return <Setup ctx={ctx} />;

  let screen;
  if (route[0] === "p" && route[1]) {
    const id = route[1];
    if (route[2] === "f" && route[3]) screen = <FindingDetail ctx={ctx} pid={id} fid={route[3]} />;
    else if (route[2] === "findings") screen = <Findings ctx={ctx} pid={id} />;
    else if (route[2] === "loop") screen = <AgentLoop ctx={ctx} pid={id} />;
    else if (route[2] === "gate") screen = <ReviewGate ctx={ctx} pid={id} />;
    else if (route[2] === "history") screen = <History ctx={ctx} pid={id} />;
    else if (route[2] === "settings") screen = <ProjectSettings ctx={ctx} pid={id} />;
    else screen = <Overview ctx={ctx} pid={id} />;
  } else if (route[0] === "settings") screen = <Settings ctx={ctx} section={route[1] ?? "scanners"} />;
  else screen = <AllProjects ctx={ctx} />;

  return (
    <div className="shell">
      <Sidebar ctx={ctx} route={route} />
      <main className="main">{screen}</main>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
