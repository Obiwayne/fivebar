import { useCallback, useEffect, useState } from "react";
import { api, type Finding, type ProjectDetail } from "../api";

export function useProject(pid: string) {
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<ProjectDetail>(`projects/${pid}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pid]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  return { data, error, load };
}

export function useFindings(pid: string, status?: string) {
  const [list, setList] = useState<Finding[] | null>(null);
  const load = useCallback(async () => {
    setList(await api<Finding[]>(`projects/${pid}/findings${status ? `?status=${status}` : ""}`));
  }, [pid, status]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  return { list, load };
}

export function Crumbs({ items }: { items: string[] }) {
  return (
    <div className="crumbs">
      {items.map((it, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span>/</span>}
          {i === items.length - 1 ? <b>{it}</b> : <span>{it}</span>}
        </span>
      ))}
    </div>
  );
}

export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;
export function bySeverity(a: Finding, b: Finding) {
  return SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.file.localeCompare(b.file);
}
