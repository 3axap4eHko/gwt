import { $ } from "bun";
import { openSync, closeSync } from "fs";
import { isatty } from "tty";
import { select, isCancel } from "@clack/prompts";
import { findGwtRoot, checkGwtSetup, parseWorktreeList } from "../core/repo";

interface Worktree {
  path: string;
  name: string;
  branch: string | null;
  mtime: number;
}

interface CdOptions {
  open?: boolean;
  edit?: boolean;
  exec?: string[];
}

export async function cd(name?: string, options: CdOptions = {}): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    console.error(`Error: ${check.error}`);
    process.exit(1);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const worktrees = await getWorktrees();

  if (worktrees.length === 0) {
    console.error("No worktrees found");
    process.exit(1);
  }

  if (name) {
    const wt = worktrees.find(w => w.name === name);
    if (!wt) {
      console.error(`Worktree '${name}' not found`);
      console.error(`Available: ${worktrees.map(w => w.name).join(", ")}`);
      process.exit(1);
    }
    await handleActions(wt.path, options);
    return;
  }

  const maxName = Math.max(...worktrees.map(w => w.name.length));

  const selected = await select({
    message: "Select worktree",
    output: process.stderr,
    options: worktrees.map(wt => {
      const name = wt.name.padEnd(maxName);
      const branch = wt.branch ?? "(detached)";
      const age = formatAge(wt.mtime);
      return {
        value: wt,
        label: `${name}  ${branch}  ${age}`,
      };
    }),
  });

  if (isCancel(selected)) {
    process.exit(1);
  }

  await handleActions(selected.path, options);
}

async function handleActions(path: string, options: CdOptions): Promise<void> {
  if (options.open) {
    await openInFileManager(path);
  }
  if (options.edit) {
    await openInEditor(path);
  }
  if (options.exec) {
    await execInWorktree(path, options.exec);
  }
  console.log(path);
}

async function execInWorktree(path: string, command: string[]): Promise<void> {
  if (!isatty(0)) {
    console.error("Error: --exec requires an interactive terminal");
    process.exit(1);
  }

  const tty = openSync("/dev/tty", "r+");

  try {
    const proc = Bun.spawn(command, {
      cwd: path,
      stdin: tty,
      stdout: tty,
      stderr: tty,
    });

    const signals = ["SIGINT", "SIGTERM", "SIGTSTP", "SIGCONT"] as const;
    const handlers: Array<{ sig: typeof signals[number]; handler: () => void }> = [];

    for (const sig of signals) {
      const handler = () => proc.kill(sig);
      process.on(sig, handler);
      handlers.push({ sig, handler });
    }

    const exitCode = await proc.exited;

    for (const { sig, handler } of handlers) {
      process.off(sig, handler);
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } finally {
    closeSync(tty);
  }
}

async function openInFileManager(path: string): Promise<void> {
  const platform = process.platform;
  const isWSL = platform === "linux" && process.env.WSL_DISTRO_NAME;

  let cmd: string[];
  if (platform === "darwin") {
    cmd = ["open", path];
  } else if (platform === "win32") {
    cmd = ["explorer", path];
  } else if (isWSL) {
    cmd = ["wslview", path];
  } else {
    cmd = ["xdg-open", path];
  }

  await $`${cmd}`.quiet().nothrow();
}

async function openInEditor(path: string): Promise<void> {
  const ide = await detectIde();
  if (!ide) {
    console.error("No IDE found. Set one with: git config --global gwt.ide <ide>");
    process.exit(1);
  }
  const result = await $`${ide} ${path}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(`Warning: Failed to open ${ide}`);
  }
}

async function detectIde(): Promise<string | null> {
  const configResult = await $`git config gwt.ide`.quiet().nothrow();
  if (configResult.exitCode === 0) {
    const ide = configResult.stdout.toString().trim();
    if (ide) return ide;
  }

  const visual = process.env.VISUAL;
  if (visual) return visual;

  const candidates = ["zed", "nvim", "cursor", "code"];
  for (const ide of candidates) {
    const result = await $`command -v ${ide}`.quiet().nothrow();
    if (result.exitCode === 0) {
      return ide;
    }
  }

  const editor = process.env.EDITOR;
  if (editor) return editor;

  return null;
}

async function getWorktrees(): Promise<Worktree[]> {
  const result = await $`git worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error("Error: Failed to list worktrees");
    process.exit(1);
  }

  const parsed = parseWorktreeList(result.stdout.toString()).filter(wt => !wt.isBare);

  const worktrees = await Promise.all(
    parsed.map(async ({ path, name, branch }) => {
      let mtime = 0;
      try {
        const stat = await Bun.file(path).stat();
        mtime = stat?.mtime?.getTime() ?? 0;
      } catch {}
      return { path, name, branch, mtime };
    })
  );

  return worktrees.sort((a, b) => b.mtime - a.mtime);
}

function formatAge(mtime: number): string {
  if (!mtime) return "";
  const diff = Date.now() - mtime;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
