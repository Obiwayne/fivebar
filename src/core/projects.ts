import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isGitRepo } from "./git.js";
import { Store } from "./store.js";
import { DEFAULT_SETTINGS, type Project } from "./types.js";

export interface Detected {
  languages: string[];
  managers: string[];
  testCommand?: string;
  git: boolean;
}

const LANG_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".java": "Java", ".cs": "C#", ".php": "PHP",
};

/** A quick look at a folder: languages, package managers and a test command. Reads at most a few hundred files. */
export async function detect(root: string): Promise<Detected> {
  const langs = new Set<string>();
  const walk = (dir: string, depth: number, budget: { n: number }) => {
    if (depth > 4 || budget.n <= 0) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (budget.n-- <= 0) return;
      if (e.name.startsWith(".") || ["node_modules", "dist", "build", "vendor", "target", "venv", ".venv"].includes(e.name)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1, budget);
      else if (LANG_EXT[path.extname(e.name)]) langs.add(LANG_EXT[path.extname(e.name)]);
    }
  };
  walk(root, 0, { n: 600 });
  const has = (f: string) => fs.existsSync(path.join(root, f));
  const managers: string[] = [];
  if (has("package-lock.json")) managers.push("npm");
  if (has("pnpm-lock.yaml")) managers.push("pnpm");
  if (has("yarn.lock")) managers.push("yarn");
  if (has("requirements.txt") || has("pyproject.toml")) managers.push("pip");
  if (has("Cargo.toml")) managers.push("cargo");
  if (has("go.mod")) managers.push("go");
  let testCommand: string | undefined;
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) testCommand = "npm test";
    } catch { /* ignore */ }
  } else if (has("pyproject.toml") || has("pytest.ini")) testCommand = "pytest";
  else if (has("Cargo.toml")) testCommand = "cargo test";
  return { languages: [...langs], managers, testCommand, git: await isGitRepo(root) };
}

export async function addProject(store: Store, folder: string): Promise<Project> {
  const root = path.resolve(folder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Folder not found: ${root}`);
  const existing = (await store.listProjects()).find((p) => path.resolve(p.path).toLowerCase() === root.toLowerCase());
  if (existing) return existing;
  const name = path.basename(root);
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 6)}`;
  const project: Project = {
    id,
    name,
    path: root,
    addedAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    connection: { claudeMcp: false, stopHook: false, prePush: false, findingsFile: false },
  };
  await store.saveProject(project);
  await store.addEvent(id, "project", `Added ${name}`);
  return project;
}

/** Find the project that owns a folder, for hooks and the MCP server that only know their working directory. */
export async function projectForDir(store: Store, dir: string): Promise<Project | undefined> {
  return store.findProjectByPath(dir);
}
