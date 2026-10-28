import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { dataDir } from "./paths.js";
import {
  DEFAULT_SETTINGS,
  type AgentLoop,
  type Finding,
  type HistoryEvent,
  type Project,
  type ScanRecord,
} from "./types.js";

const require = createRequire(import.meta.url);
let SQL: SqlJsStatic | undefined;

async function sqlJs(): Promise<SqlJsStatic> {
  if (!SQL) {
    const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    SQL = await initSqlJs({ locateFile: (f: string) => path.join(wasmDir, f) });
  }
  return SQL;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL,
  file TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (project_id, id));
CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, started_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS loops (session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A small SQLite store shared by the desktop app, the CLI, the hooks and the MCP server.
 * Each call takes a file lock, loads the database, runs, and saves, so separate processes
 * never overwrite each other's changes.
 */
export class Store {
  private constructor(private file: string) {}

  static async open(file = path.join(dataDir(), "fivebar.db")): Promise<Store> {
    await sqlJs();
    return new Store(file);
  }

  private async lock(): Promise<() => void> {
    const lockPath = `${this.file}.lock`;
    const started = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return () => fs.rmSync(lockPath, { force: true });
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 20_000) fs.rmSync(lockPath, { force: true });
        } catch { /* lock vanished */ }
        if (Date.now() - started > 15_000) throw new Error("Fivebar database is busy. Try again in a moment.");
        await sleep(30);
      }
    }
  }

  async run<T>(write: boolean, fn: (db: Database) => T): Promise<T> {
    const S = await sqlJs();
    const release = await this.lock();
    try {
      const db = fs.existsSync(this.file) ? new S.Database(fs.readFileSync(this.file)) : new S.Database();
      db.run(SCHEMA);
      const out = fn(db);
      if (write || !fs.existsSync(this.file)) {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, Buffer.from(db.export()));
        fs.renameSync(tmp, this.file);
      }
      db.close();
      return out;
    } finally {
      release();
    }
  }

  // ---- helpers -------------------------------------------------------------

  private static rows<T>(db: Database, sql: string, params: any[] = []): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    stmt.free();
    return out;
  }

  // ---- projects ------------------------------------------------------------

  listProjects(): Promise<Project[]> {
    return this.run(false, (db) =>
      Store.rows<{ data: string }>(db, "SELECT data FROM projects").map((r) => normaliseProject(JSON.parse(r.data))),
    );
  }

  async getProject(id: string): Promise<Project | undefined> {
    return (await this.listProjects()).find((p) => p.id === id);
  }

  async findProjectByPath(p: string): Promise<Project | undefined> {
    const want = path.resolve(p).toLowerCase();
    const all = await this.listProjects();
    // The longest project path that contains p wins, so nested folders resolve to their project.
    return all
      .filter((x) => want === path.resolve(x.path).toLowerCase() || want.startsWith(path.resolve(x.path).toLowerCase() + path.sep))
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  saveProject(p: Project): Promise<void> {
    return this.run(true, (db) => {
      db.run("INSERT OR REPLACE INTO projects (id, data) VALUES (?, ?)", [p.id, JSON.stringify(p)]);
    });
  }

  removeProject(id: string): Promise<void> {
    return this.run(true, (db) => {
      for (const t of ["projects"]) db.run(`DELETE FROM ${t} WHERE id = ?`, [id]);
      for (const t of ["findings", "scans", "events", "loops"]) db.run(`DELETE FROM ${t} WHERE project_id = ?`, [id]);
    });
  }

  // ---- findings ------------------------------------------------------------

  listFindings(projectId: string, opts: { status?: string } = {}): Promise<Finding[]> {
    return this.run(false, (db) => {
      const sql = opts.status
        ? "SELECT data FROM findings WHERE project_id = ? AND status = ?"
        : "SELECT data FROM findings WHERE project_id = ?";
      const params = opts.status ? [projectId, opts.status] : [projectId];
      return Store.rows<{ data: string }>(db, sql, params).map((r) => JSON.parse(r.data) as Finding);
    });
  }

  async getFinding(projectId: string, id: string): Promise<Finding | undefined> {
    return this.run(false, (db) => {
      const r = Store.rows<{ data: string }>(db, "SELECT data FROM findings WHERE project_id = ? AND id = ?", [projectId, id])[0];
      return r ? (JSON.parse(r.data) as Finding) : undefined;
    });
  }

  static putFinding(db: Database, f: Finding) {
    db.run("INSERT OR REPLACE INTO findings (id, project_id, status, severity, file, data) VALUES (?, ?, ?, ?, ?, ?)", [
      f.id, f.projectId, f.status, f.severity, f.file, JSON.stringify(f),
    ]);
  }

  saveFinding(f: Finding): Promise<void> {
    return this.run(true, (db) => Store.putFinding(db, f));
  }

  // ---- scans, events, loops --------------------------------------------------

  listScans(projectId: string, limit = 50): Promise<ScanRecord[]> {
    return this.run(false, (db) =>
      Store.rows<{ id: number; data: string }>(db, "SELECT id, data FROM scans WHERE project_id = ? ORDER BY id DESC LIMIT ?", [projectId, limit])
        .map((r) => ({ ...(JSON.parse(r.data) as ScanRecord), id: r.id })),
    );
  }

  static insertScan(db: Database, s: Omit<ScanRecord, "id">): number {
    db.run("INSERT INTO scans (project_id, started_at, data) VALUES (?, ?, ?)", [s.projectId, s.startedAt, JSON.stringify(s)]);
    return Number(Store.rows<{ id: number }>(db, "SELECT last_insert_rowid() AS id")[0].id);
  }

  static insertEvent(db: Database, projectId: string, kind: string, text: string, data?: unknown) {
    db.run("INSERT INTO events (project_id, at, kind, text, data) VALUES (?, ?, ?, ?, ?)", [
      projectId, new Date().toISOString(), kind, text, data === undefined ? null : JSON.stringify(data),
    ]);
  }

  addEvent(projectId: string, kind: string, text: string, data?: unknown): Promise<void> {
    return this.run(true, (db) => Store.insertEvent(db, projectId, kind, text, data));
  }

  listEvents(projectId: string, limit = 100): Promise<HistoryEvent[]> {
    return this.run(false, (db) =>
      Store.rows<{ id: number; project_id: string; at: string; kind: string; text: string; data: string | null }>(
        db, "SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT ?", [projectId, limit],
      ).map((r) => ({ id: r.id, projectId: r.project_id, at: r.at, kind: r.kind, text: r.text, data: r.data ? JSON.parse(r.data) : undefined })),
    );
  }

  getLoop(sessionId: string): Promise<AgentLoop | undefined> {
    return this.run(false, (db) => {
      const r = Store.rows<{ data: string }>(db, "SELECT data FROM loops WHERE session_id = ?", [sessionId])[0];
      return r ? (JSON.parse(r.data) as AgentLoop) : undefined;
    });
  }

  saveLoop(l: AgentLoop): Promise<void> {
    return this.run(true, (db) => {
      db.run("INSERT OR REPLACE INTO loops (session_id, project_id, updated_at, data) VALUES (?, ?, ?, ?)", [
        l.sessionId, l.projectId, l.updatedAt, JSON.stringify(l),
      ]);
    });
  }

  listLoops(projectId: string, limit = 20): Promise<AgentLoop[]> {
    return this.run(false, (db) =>
      Store.rows<{ data: string }>(db, "SELECT data FROM loops WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?", [projectId, limit])
        .map((r) => JSON.parse(r.data) as AgentLoop),
    );
  }

  getSetting<T>(key: string, fallback: T): Promise<T> {
    return this.run(false, (db) => {
      const r = Store.rows<{ value: string }>(db, "SELECT value FROM settings WHERE key = ?", [key])[0];
      return r ? (JSON.parse(r.value) as T) : fallback;
    });
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.run(true, (db) => {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
    });
  }
}

function normaliseProject(p: Project): Project {
  return {
    ...p,
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
    connection: { claudeMcp: false, stopHook: false, prePush: false, findingsFile: false, ...((p.connection ?? {}) as Partial<Project["connection"]>) },
  };
}
