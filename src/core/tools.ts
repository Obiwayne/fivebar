import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { unzipSync } from "fflate";
import { toolsDir } from "./paths.js";
import type { ToolName } from "./types.js";

interface ToolSpec {
  name: ToolName;
  label: string;
  version: string;
  licence: string;
  url: string;
  /** SHA-256 of the downloaded file, from the publisher's checksum file (Opengrep publishes signatures, so we pin our own). */
  sha256: string;
  exe: string;
  /** For zip downloads, the file to pull out. */
  zipEntry?: string;
}

// Pinned versions. Bumping one means updating the hash from the publisher's checksum file.
export const TOOLS: ToolSpec[] = [
  {
    name: "opengrep",
    label: "Opengrep",
    version: "1.33.0",
    licence: "LGPL-2.1",
    url: "https://github.com/opengrep/opengrep/releases/download/v1.33.0/opengrep_windows_x86.exe",
    sha256: "9a9e90f187f73149f4d141f78241d18282538ce94d555d7515ca9cd70e8f22e9",
    exe: "opengrep.exe",
  },
  {
    name: "gitleaks",
    label: "Gitleaks",
    version: "8.30.1",
    licence: "MIT",
    url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip",
    sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
    exe: "gitleaks.exe",
    zipEntry: "gitleaks.exe",
  },
  {
    name: "osv-scanner",
    label: "OSV-Scanner",
    version: "2.7.0",
    licence: "Apache-2.0",
    url: "https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_windows_amd64.exe",
    sha256: "9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438",
    exe: "osv-scanner.exe",
  },
];

export function toolPath(name: ToolName): string {
  const spec = TOOLS.find((t) => t.name === name)!;
  return path.join(toolsDir(), spec.exe);
}

export interface ToolStatus {
  name: ToolName;
  label: string;
  version: string;
  licence: string;
  installed: boolean;
  path: string;
}

export function toolStatus(): ToolStatus[] {
  return TOOLS.map((t) => ({
    name: t.name,
    label: t.label,
    version: t.version,
    licence: t.licence,
    installed: fs.existsSync(toolPath(t.name)),
    path: toolPath(t.name),
  }));
}

function sha256(buf: Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Download any missing scanner, check its SHA-256, and unpack it into the tools folder. */
export async function installTools(onProgress: (msg: string) => void = () => {}): Promise<ToolStatus[]> {
  for (const t of TOOLS) {
    const dest = toolPath(t.name);
    if (fs.existsSync(dest)) continue;
    onProgress(`Downloading ${t.label} ${t.version}`);
    const res = await fetch(t.url);
    if (!res.ok) throw new Error(`Download of ${t.label} failed: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== t.sha256) throw new Error(`${t.label} checksum did not match. Expected ${t.sha256}, got ${got}. Nothing was installed.`);
    onProgress(`${t.label} verified`);
    let bytes = buf;
    if (t.zipEntry) {
      const files = unzipSync(buf);
      const entry = files[t.zipEntry];
      if (!entry) throw new Error(`${t.label} archive has no ${t.zipEntry}`);
      bytes = entry;
    }
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
  }
  return toolStatus();
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function exec(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err: any, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : err.killed ? 124 : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) + (err && typeof err.code !== "number" ? String(err.message) : ""), durationMs: Date.now() - started });
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}
