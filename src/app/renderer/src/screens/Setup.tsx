import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "../api";
import type { Ctx } from "../main";
import { Shield } from "../ui";

const STEPS = ["Coding agents", "Check your PC", "Install scanners", "Guards", "Phone alerts", "First project"];

const AGENTS = [
  { id: "claude-code", name: "Claude Code", sub: "Fivebar sends findings back through an MCP server and a Stop hook. Full support." },
  { id: "codex", name: "Codex", sub: "Reads a findings file in the project. A direct connector comes next." },
  { id: "antigravity", name: "Antigravity", sub: "Reads a findings file in the project for now." },
];

type Env = Record<"claude" | "codex" | "git" | "gh" | "tailscale", string | null>;

export function Setup({ ctx }: { ctx: Ctx }) {
  const [step, setStep] = useState(0);
  const [agents, setAgents] = useState<string[]>(ctx.state.settings.agents ?? ["claude-code"]);
  const [env, setEnv] = useState<Env | null>(null);
  const [installing, setInstalling] = useState(false);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (step === 1 && !env) api<Env>("environment").then(setEnv); }, [step, env]);

  const toolsReady = ctx.state.tools.every((t) => t.installed);
  const toggle = (id: string) => setAgents(agents.includes(id) ? agents.filter((a) => a !== id) : [...agents, id]);

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await api("tools/install", { method: "POST" });
      await ctx.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }
  async function finish(addFolder: boolean) {
    setError(null);
    try {
      let target = "";
      if (addFolder && folder.trim()) {
        setBusy("Adding the project…");
        const { project } = await api<{ project: ProjectSummary }>("projects", { method: "POST", body: { path: folder.trim() } });
        setBusy("Running the first scan…");
        await api(`projects/${project.id}/scan`, { method: "POST" });
        target = `p/${project.id}`;
      }
      await api("settings", { method: "POST", body: { setupDone: true, agents } });
      await ctx.reload();
      ctx.go(target);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const canNext = [agents.length > 0, !!env, toolsReady, true, true, true][step];
  let body;
  if (step === 0) {
    body = (
      <>
        <h1>Which coding agents do you use?</h1>
        <div className="muted">Pick one or more. You can change this later in Settings.</div>
        <div className="col" style={{ gap: 10 }}>
          {AGENTS.map((a) => (
            <button key={a.id} className={`choice ${agents.includes(a.id) ? "on" : ""}`} onClick={() => toggle(a.id)}>
              <span className="box">{agents.includes(a.id) ? "✓" : ""}</span>
              <span className="col" style={{ gap: 3 }}><b style={{ fontWeight: 500, fontSize: 16 }}>{a.name}</b><span className="muted" style={{ fontSize: 13 }}>{a.sub}</span></span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (step === 1) {
    const rows: [string, string | null | undefined, boolean][] = [
      ["Git", env?.git, true],
      ...(agents.includes("claude-code") ? [["Claude Code", env?.claude, true] as [string, string | null | undefined, boolean]] : []),
      ...(agents.includes("codex") ? [["Codex", env?.codex, false] as [string, string | null | undefined, boolean]] : []),
      ["Tailscale (for phone alerts)", env?.tailscale, false],
    ];
    body = (
      <>
        <h1>Checking your PC</h1>
        <div className="muted">Fivebar uses the tools you already have. It doesn't install them for you.</div>
        <div className="card col rows" style={{ gap: 0 }}>
          {rows.map(([name, v, needed]) => (
            <div key={name} className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
              <span>{name}{!needed && <span className="muted"> · optional</span>}</span>
              <span className="mono" style={{ fontSize: 11, color: !env ? "var(--graphite)" : v ? "var(--pass)" : needed ? "var(--signal)" : "var(--graphite)" }}>{!env ? "CHECKING…" : v ? v.slice(0, 36) : "NOT FOUND"}</span>
            </div>
          ))}
        </div>
        {env && !env.claude && agents.includes("claude-code") && <div style={{ color: "var(--signal)", fontSize: 13 }}>Claude Code wasn't found. Install it, then come back. Fivebar still scans without it.</div>}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h1>Install the three scanners</h1>
        <div className="muted">About 70 MB from each project's GitHub release. Fivebar checks every file against a pinned SHA-256 before it runs.</div>
        <div className="card col rows" style={{ gap: 0 }}>
          {ctx.state.tools.map((t) => (
            <div key={t.name} className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
              <span className="col" style={{ gap: 2 }}><span>{t.label} {t.version}</span><span className="muted" style={{ fontSize: 12 }}>{t.licence}</span></span>
              <span className="mono" style={{ fontSize: 11, color: t.installed ? "var(--pass)" : "var(--graphite)" }}>{t.installed ? "READY" : installing ? "DOWNLOADING…" : "NOT INSTALLED"}</span>
            </div>
          ))}
        </div>
        {!toolsReady && <button className="btn primary" style={{ width: "fit-content" }} disabled={installing} onClick={install}>{installing ? "Downloading and checking…" : "Install scanners"}</button>}
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <h1>Guards</h1>
        <div className="muted">Guards stop risky commands inside the coding agent before they run, like rm -rf or a force push.</div>
        <div className="card col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}><span className="soon">COMING NEXT</span><span style={{ fontSize: 14 }}>Guards arrive in the next release. Nothing to set now.</span></div>
        </div>
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <h1>Phone alerts</h1>
        <div className="muted">Get told on your phone when the agent loop needs you, over your own Tailscale network.</div>
        <div className="card col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: "center" }}><span className="soon">COMING NEXT</span><span style={{ fontSize: 14 }}>The phone app comes in a later release.</span></div>
          <div className="muted" style={{ fontSize: 13 }}>For now you can steer a Claude Code session from the Claude app with /remote-control.</div>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1>Add your first project</h1>
        <div className="muted">Paste a project folder. Fivebar scans it straight away. Nothing in the project changes until you connect it.</div>
        <input type="text" id="setup-folder" className="mono" placeholder={"F:\\RepoQuarry-Builds\\my-app"} value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && folder && finish(true)} />
        {busy && <div className="muted" style={{ fontSize: 13 }}>{busy}</div>}
      </>
    );
  }

  return (
    <div className="setup">
      <div className="setup-left">
        <div className="col" style={{ gap: 36 }}>
          <div className="brand" style={{ color: "#f6f5f1" }}><Shield size={26} /> fivebar</div>
          <div className="col" style={{ gap: 2 }}>
            {STEPS.map((s, i) => (
              <div key={s} className={`step ${i < step ? "done" : i === step ? "now" : ""}`}><i>{i < step ? "✓" : i + 1}</i>{s}</div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#8e8c84" }}>Everything stays on this PC.</div>
      </div>
      <div className="setup-right">
        <div className="label">Step {step + 1} of {STEPS.length}</div>
        <div className="progress"><div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        {body}
        {error && <div style={{ color: "var(--signal)", fontSize: 13 }}>{error}</div>}
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          {step > 0 && <button className="btn" disabled={!!busy} onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1 && <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>}
          {step === STEPS.length - 1 && (
            <>
              <button className="btn primary" disabled={!folder.trim() || !!busy} onClick={() => finish(true)}>Add and scan</button>
              <button className="btn" disabled={!!busy} onClick={() => finish(false)}>Skip for now</button>
            </>
          )}
          {step === 2 && !toolsReady && <button className="btn" onClick={() => setStep(3)}>Skip</button>}
        </div>
      </div>
    </div>
  );
}
