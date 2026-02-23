import { findGwtRoot, checkGwtSetup, getWorktrees } from "../core/repo";
import { resolveWorktree, selectWorktree } from "./cd";

export async function run(command: string[], worktreeName?: string): Promise<void> {
  if (command.length === 0) {
    throw new Error("Error: run requires a command");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const worktrees = await getWorktrees();

  if (worktrees.length === 0) {
    throw new Error("No worktrees found");
  }

  const wt = worktreeName ? resolveWorktree(worktrees, worktreeName) : await selectWorktree(worktrees);
  await execInWorktree(wt.path, command);
}

async function execInWorktree(path: string, command: string[]): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: path,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const signals: NodeJS.Signals[] =
    process.platform === "win32"
      ? ["SIGINT", "SIGTERM"]
      : ["SIGINT", "SIGTERM", "SIGTSTP", "SIGCONT"];
  const handlers: Array<{ sig: NodeJS.Signals; handler: () => void }> = [];

  for (const sig of signals) {
    const handler = () => proc.kill(sig);
    process.on(sig, handler);
    handlers.push({ sig, handler });
  }

  try {
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } finally {
    for (const { sig, handler } of handlers) {
      process.off(sig, handler);
    }
  }
}
