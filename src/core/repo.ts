import { $ } from "bun";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, parse, resolve } from "path";

const VERSION = "0.1.0";

export interface GwtConfig {
  version: string | null;
  defaultBranch: string | null;
}

let cachedRoot: string | null | undefined = undefined;
let cachedConfig: GwtConfig | null = null;

export function findGwtRoot(startDir?: string): string | null {
  if (cachedRoot !== undefined && !startDir) {
    return cachedRoot;
  }

  let dir = startDir ?? process.cwd();

  while (dir !== "/" && dir !== parse(dir).root) {
    if (existsSync(resolve(dir, ".bare"))) {
      if (!startDir) cachedRoot = dir;
      return dir;
    }

    const gitPath = resolve(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const content = readFileSync(gitPath, "utf-8");
        if (content.startsWith("gitdir:")) {
          const parent = dirname(dir);
          if (existsSync(resolve(parent, ".bare"))) {
            if (!startDir) cachedRoot = parent;
            return parent;
          }
        }
      } catch {}
    }

    dir = dirname(dir);
  }

  if (!startDir) cachedRoot = null;
  return null;
}

export function getGwtConfig(): GwtConfig | null {
  if (cachedConfig) return cachedConfig;

  const root = findGwtRoot();
  if (!root) return null;

  const configPath = resolve(root, ".bare", "config");
  if (!existsSync(configPath)) return null;

  try {
    const content = readFileSync(configPath, "utf-8");
    const config: GwtConfig = {
      version: extractConfigValue(content, "gwt", "version"),
      defaultBranch: extractConfigValue(content, "gwt", "defaultBranch"),
    };
    cachedConfig = config;
    return config;
  } catch {
    return null;
  }
}

function extractConfigValue(content: string, section: string, key: string): string | null {
  const sectionRegex = new RegExp(`\\[${section}\\]([^\\[]*?)(?=\\[|$)`, "s");
  const sectionMatch = content.match(sectionRegex);
  if (!sectionMatch) return null;

  const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m");
  const keyMatch = sectionMatch[1].match(keyRegex);
  if (!keyMatch) return null;

  const value = keyMatch[1].trim().replace(/^["']|["']$/g, "");
  return value;
}

export function getDefaultBranch(): string | null {
  const config = getGwtConfig();
  return config?.defaultBranch ?? null;
}

export function getCurrentVersion(): string {
  return VERSION;
}

export function isGwtManaged(): boolean {
  const config = getGwtConfig();
  return config?.version !== null;
}

export function needsUpgrade(): boolean {
  const config = getGwtConfig();
  if (!config?.version) return false;
  return config.version !== VERSION;
}

export function checkGwtSetup(): { ok: boolean; error?: string } {
  const root = findGwtRoot();
  if (!root) {
    return { ok: false, error: "Not in a gwt-managed repository. Run 'gwt clone' or 'gwt init'." };
  }

  const config = getGwtConfig();
  if (!config?.version) {
    return { ok: false, error: `Found .bare but not gwt-managed. Run 'gwt init' to set up.` };
  }

  return { ok: true };
}

export function clearCache(): void {
  cachedRoot = undefined;
  cachedConfig = null;
}

export async function detectDefaultBranch(): Promise<string> {
  const symbolicRef = await $`git symbolic-ref refs/remotes/origin/HEAD`.quiet().nothrow();
  if (symbolicRef.exitCode === 0) {
    return symbolicRef.stdout.toString().trim().replace("refs/remotes/origin/", "");
  }

  for (const branch of ["master", "main", "trunk", "develop"]) {
    const result = await $`git show-ref --verify refs/remotes/origin/${branch}`.quiet().nothrow();
    if (result.exitCode === 0) {
      return branch;
    }
  }

  const branches = await $`git branch -r`.quiet().nothrow();
  if (branches.exitCode === 0) {
    const lines = branches.stdout.toString().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes("->")) {
        return trimmed.replace("origin/", "");
      }
    }
  }

  return "master";
}

export interface WorktreeInfo {
  path: string;
  name: string;
  commit?: string;
  branch: string | null;
  isBare: boolean;
}

export function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const entries = output.trim().split("\n\n");

  for (const entry of entries) {
    const lines = entry.split("\n");
    let path = "";
    let commit: string | undefined;
    let branch: string | null = null;
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice(9);
      } else if (line.startsWith("HEAD ")) {
        commit = line.slice(5);
      } else if (line.startsWith("branch ")) {
        branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        isBare = true;
      } else if (line === "detached") {
        branch = null;
      }
    }

    if (path) {
      worktrees.push({
        path,
        name: basename(path),
        commit,
        branch,
        isBare,
      });
    }
  }

  return worktrees;
}
