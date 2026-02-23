import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from "fs";
import { resolve } from "path";

const RC_FILES: Record<string, string> = {
  zsh: ".zshrc",
  bash: ".bashrc",
  fish: ".config/fish/config.fish",
};

function detectShell(): string {
  const shellEnv = process.env.SHELL ?? "";
  if (shellEnv.includes("fish")) return "fish";
  if (shellEnv.includes("zsh")) return "zsh";
  return "bash";
}

function shellIntegrationLine(shell: string): string {
  if (shell === "fish") return `gwt shell fish | source`;
  return `eval "$(gwt shell)"`;
}

function isOnPath(dir: string): boolean {
  const normalized = dir.replace(/\/+$/, "");
  const pathDirs = (process.env.PATH ?? "").split(":");
  return pathDirs.some(p => p.replace(/\/+$/, "") === normalized);
}

function isSameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export function install(dir?: string): void {
  const home = process.env.HOME;
  if (!home) throw new Error("$HOME is not set");

  const installDir = dir ?? resolve(home, ".local", "bin");
  const dest = resolve(installDir, "gwt");
  const src = process.execPath;
  const shell = detectShell();
  const rcName = RC_FILES[shell];
  const rcPath = rcName ? resolve(home, rcName) : null;

  const actions: string[] = [];

  mkdirSync(installDir, { recursive: true });

  if (isSameFile(src, dest)) {
    actions.push(`gwt already installed at ${dest}`);
  } else {
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
    actions.push(`Copied gwt to ${dest}`);
  }

  if (!isOnPath(installDir)) {
    const pathLine = shell === "fish"
      ? `fish_add_path ${installDir}`
      : `export PATH="${installDir}:$PATH"`;
    actions.push(`${installDir} is not in PATH. Add to your ${rcPath ?? "shell config"}:\n  ${pathLine}`);
  }

  if (rcPath) {
    const rcContent = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : "";

    if (!rcContent.includes("gwt shell")) {
      const integrationLine = shellIntegrationLine(shell);
      appendFileSync(rcPath, `\n${integrationLine}\n`);
      actions.push(`Added shell integration to ${rcPath}`);
    }
  }

  console.log(actions.join("\n"));

  const needsReload = actions.some(a => a.includes("Added shell integration"));
  if (rcPath && needsReload) {
    console.log(`\nRestart your shell or run: source ${rcPath}`);
  }
}
