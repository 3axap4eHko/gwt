import { select, isCancel } from "@clack/prompts";
import { findGwtRoot, checkGwtSetup, getWorktrees, formatAge, type Worktree } from "../core/repo";

export async function cd(name?: string): Promise<void> {
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

  const wt = name ? resolveWorktree(worktrees, name) : await selectWorktree(worktrees);
  console.log(wt.path);
}

export function resolveWorktree(worktrees: Worktree[], name: string): Worktree {
  const wt = worktrees.find(w => w.name === name);
  if (!wt) {
    throw new Error(`Worktree '${name}' not found\nAvailable: ${worktrees.map(w => w.name).join(", ")}`);
  }
  return wt;
}

export async function selectWorktree(worktrees: Worktree[]): Promise<Worktree> {
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

  return selected;
}
