import { useEffect, useState, type ReactNode } from "react";
import type { Finding, Severity } from "./api";

export function Shield({ size = 24, small = size < 32 }: { size?: number; small?: boolean }) {
  // Five bars at full size, three below 32 px so it stays sharp in the sidebar and tray.
  return small ? (
    <svg width={size} height={size} viewBox="0 0 180 180" aria-hidden>
      <defs><clipPath id="sh-s"><path d="M40 30 H140 V82 C140 114 118 136 90 152 C62 136 40 114 40 82 Z" /></clipPath></defs>
      <g clipPath="url(#sh-s)">
        <rect x="30" y="30" width="120" height="22" fill="currentColor" />
        <rect x="30" y="66" width="120" height="22" fill="currentColor" />
        <rect x="30" y="102" width="120" height="50" fill="var(--signal)" />
      </g>
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 180 180" aria-hidden>
      <defs><clipPath id="sh-l"><path d="M46 34 H134 V82 C134 111 115 132 90 146 C65 132 46 111 46 82 Z" /></clipPath></defs>
      <g clipPath="url(#sh-l)" fill="currentColor">
        <rect x="40" y="34" width="100" height="15" /><rect x="40" y="56" width="100" height="15" />
        <rect x="40" y="78" width="100" height="15" /><rect x="40" y="100" width="100" height="15" />
        <rect x="40" y="122" width="100" height="26" fill="var(--signal)" />
      </g>
    </svg>
  );
}

const PATHS: Record<string, ReactNode> = {
  grid: <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>,
  list: <path d="M3 4h10M3 8h10M3 12h6" />,
  loop: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />,
  gate: <path d="M2 3h12M2 6h12M2 9h12M2 12h12" />,
  history: <path d="M3 13V8M8 13V3M13 13V6" />,
  sliders: <><path d="M2 4h7M12 4h2M2 12h3M8 12h6" /><circle cx="10.5" cy="4" r="1.6" /><circle cx="6.5" cy="12" r="1.6" /></>,
  folder: <path d="M2 4.5h4l1.2 1.5H14v6.5H2z" />,
  gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  back: <path d="M10 3L5 8l5 5" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

export function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`sev ${s}`}>{s === "medium" ? "MED" : s}</span>;
}

export function ToolBadges({ f }: { f: Finding }) {
  const tools = [...new Set(f.tools.map((t) => t.tool))];
  return <>{tools.map((t) => <span key={t} className="tool">{t}</span>)}</>;
}

export function Agree({ n }: { n: number }) {
  return (
    <span className="agree">
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? "on" : ""} />)}
      <span style={{ paddingLeft: 4 }}>{n} tool{n === 1 ? "" : "s"}</span>
    </span>
  );
}

export function where(f: Finding): string {
  return `${f.file}${f.startLine ? `:${f.startLine}` : ""}`;
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function Sparkline({ points, width = 292, height = 44 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden><line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="var(--hairline)" /></svg>;
  const x = (i: number) => (i / (points.length - 1)) * (width - 6) + 3;
  const y = (v: number) => height - 4 - (v / 100) * (height - 8);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={3.5} fill="var(--signal)" />
    </svg>
  );
}

export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}

export function Dialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function sevColor(score: number | null): string {
  if (score === null) return "idle";
  return score < 70 ? "signal" : score < 95 ? "amber" : "";
}
