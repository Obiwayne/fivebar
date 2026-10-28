import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Ctx } from "../main";

const SECTIONS = [
  ["scanners", "Scanners"],
  ["guards", "Guards"],
  ["agents", "Coding agents"],
  ["gate", "Review gate"],
  ["schedule", "Schedule"],
  ["phone", "Phone and alerts"],
  ["about", "About"],
] as const;

type Env = Record<"claude" | "codex" | "git" | "gh" | "tailscale", string | null>;

function Row({ name, sub, children }: { name: string; sub?: string; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 16, padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
      <div className="col" style={{ gap: 2 }}><span>{name}</span>{sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}</div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

const Soon = () => <span className="soon">COMING NEXT</span>;

function useEnv() {
  const [env, setEnv] = useState<Env | null>(null);
  useEffect(() => { api<Env>("environment").then(setEnv).catch(() => {}); }, []);
  return env;
}

function Found({ v }: { v: string | null | undefined }) {
  if (v === undefined) return <span className="mono muted" style={{ fontSize: 11 }}>CHECKING…</span>;
  return <span className="mono" style={{ fontSize: 11, color: v ? "var(--pass)" : "var(--graphite)" }}>{v ? v.slice(0, 40) : "NOT FOUND"}</span>;
}

function Scanners({ ctx }: { ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  async function install() {
    setBusy(true);
    try {
      await api("tools/install", { method: "POST" });
      await ctx.reload();
      ctx.toast("Scanners installed and checked");
    } catch (e) {
      ctx.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card col" style={{ gap: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", paddingBottom: 12 }}>
        <h2>Scanners</h2>
        <button className="btn" disabled={busy} onClick={install}>{busy ? "Downloading…" : ctx.state.tools.every((t) => t.installed) ? "Reinstall" : "Install missing"}</button>
      </div>
      {ctx.state.tools.map((t) => (
        <Row key={t.name} name={`${t.label} ${t.version}`} sub={`${t.licence} · downloaded from its GitHub release, SHA-256 checked`}>
          <span className="mono" style={{ fontSize: 11, color: t.installed ? "var(--pass)" : "var(--signal)" }}>{t.installed ? "READY" : "MISSING"}</span>
        </Row>
      ))}
      <Row name="Fivebar rules" sub="12 rules for JavaScript, TypeScript and Python, run by Opengrep."><span className="mono" style={{ fontSize: 11 }}>BUILT IN</span></Row>
    </div>
  );
}

function Guards() {
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>Guards for your coding agent</h2>
      <div className="muted" style={{ fontSize: 13, paddingBottom: 12 }}>Guards stop risky commands and file writes before they happen, inside Claude Code itself.</div>
      <Row name="Block destructive commands" sub="rm -rf, force push, dropping tables"><Soon /></Row>
      <Row name="Protect secrets files" sub=".env, keys, credentials"><Soon /></Row>
      <Row name="Stop writes outside the project" sub="Keeps the agent inside its folder"><Soon /></Row>
    </div>
  );
}

function Agents({ ctx }: { ctx: Ctx }) {
  const env = useEnv();
  const agents = ctx.state.settings.agents ?? ["claude-code"];
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>Coding agents</h2>
      <Row name="Claude Code" sub={agents.includes("claude-code") ? "Chosen in setup. MCP server, Stop hook and review gate." : "Not chosen"}><Found v={env ? env.claude : undefined} /></Row>
      <Row name="Codex" sub="Reads .fivebar/findings.md. A direct connector comes next."><Found v={env ? env.codex : undefined} /></Row>
      <Row name="Antigravity" sub="Reads .fivebar/findings.md for now."><Soon /></Row>
      <Row name="Git" sub="Needed for the pre-push hook"><Found v={env ? env.git : undefined} /></Row>
      <Row name="GitHub CLI" sub="Optional"><Found v={env ? env.gh : undefined} /></Row>
    </div>
  );
}

function Gate() {
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>Review gate</h2>
      <Row name="AI reviewer" sub="claude -p with read-only tools (Read, Grep, Glob). Uses your Claude plan, no API key."><span className="mono" style={{ fontSize: 11 }}>1 JOB PER REVIEW</span></Row>
      <Row name="Pass mark" sub="All five bars must be 5"><span className="mono" style={{ fontSize: 11 }}>5/5 × 5</span></Row>
      <Row name="Tool limits" sub="Failing test caps Correctness at 2. Open critical caps Security at 1, high at 2, medium at 3."><span className="mono" style={{ fontSize: 11 }}>ON</span></Row>
      <Row name="Run the gate before every push" sub="Today you run it from the Review gate page"><Soon /></Row>
    </div>
  );
}

function Schedule() {
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>Schedule</h2>
      <Row name="Scan on every push" sub="The pre-push hook scans the files and commits you push"><span className="mono" style={{ fontSize: 11, color: "var(--pass)" }}>ON WHEN CONNECTED</span></Row>
      <Row name="Scan when Claude Code stops" sub="The Stop hook scans what the agent changed"><span className="mono" style={{ fontSize: 11, color: "var(--pass)" }}>ON WHEN CONNECTED</span></Row>
      <Row name="Nightly full scan" sub="New advisories appear for code you haven't touched"><Soon /></Row>
    </div>
  );
}

function Phone() {
  const env = useEnv();
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>Phone and alerts</h2>
      <div className="muted" style={{ fontSize: 13, paddingBottom: 12 }}>Watch the agent loop from your phone and approve a push. The phone app talks to this PC over your own Tailscale network, nothing goes through a Fivebar server.</div>
      <Row name="Tailscale" sub="Private network between your PC and phone"><Found v={env ? env.tailscale : undefined} /></Row>
      <Row name="Phone app" sub="Installs from your PC's Tailscale address"><Soon /></Row>
      <Row name="Claude Code Remote Control" sub="Run /remote-control in Claude Code to steer the session from the Claude app"><span className="mono" style={{ fontSize: 11 }}>IN CLAUDE CODE</span></Row>
    </div>
  );
}

function About({ ctx }: { ctx: Ctx }) {
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 style={{ paddingBottom: 12 }}>About</h2>
      <Row name="Fivebar" sub="Open source"><span className="mono" style={{ fontSize: 11 }}>0.1.0</span></Row>
      <Row name="Data" sub="Everything stays on this PC in %APPDATA%\Fivebar"><span className="mono" style={{ fontSize: 11 }}>LOCAL ONLY</span></Row>
      <Row name="Run setup again" sub="Pick agents and install scanners again"><button className="btn" onClick={() => ctx.go("setup")}>Open setup</button></Row>
    </div>
  );
}

export function Settings({ ctx, section }: { ctx: Ctx; section: string }) {
  const body = {
    scanners: <Scanners ctx={ctx} />, guards: <Guards />, agents: <Agents ctx={ctx} />, gate: <Gate />,
    schedule: <Schedule />, phone: <Phone />, about: <About ctx={ctx} />,
  }[section] ?? <Scanners ctx={ctx} />;
  return (
    <>
      <div className="col" style={{ gap: 4 }}>
        <h1>Settings</h1>
        <div className="muted" style={{ fontSize: 13 }}>These apply to every project unless a project changes them.</div>
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
        <nav className="col" style={{ width: 200, flexShrink: 0, gap: 2 }}>
          {SECTIONS.map(([key, label]) => (
            <button key={key} className={`nav-item ${section === key ? "active" : ""}`} onClick={() => ctx.go(`settings/${key}`)}>{label}</button>
          ))}
        </nav>
        <div className="grow col" style={{ minWidth: 0, maxWidth: 760 }}>{body}</div>
      </div>
    </>
  );
}
