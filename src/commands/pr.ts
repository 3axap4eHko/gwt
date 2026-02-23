import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, getWorktrees } from "../core/repo";
import { resolveWorktree, selectWorktree } from "./cd";

export async function pr(action?: string, name?: string): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const ghCheck = await $`command -v gh`.quiet().nothrow();
  if (ghCheck.exitCode !== 0) {
    throw new Error("Error: 'gh' CLI not found. Install it from https://cli.github.com");
  }

  const worktrees = await getWorktrees();
  if (worktrees.length === 0) {
    throw new Error("No worktrees found");
  }

  const wt = name ? resolveWorktree(worktrees, name) : await selectWorktree(worktrees);

  if (!wt.branch) {
    throw new Error("Error: Worktree is in detached HEAD state");
  }

  if (action === "create") {
    console.log(`Creating PR for '${wt.branch}'...`);
    const result = await $`gh pr create --web --head ${wt.branch}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(`Error: Failed to create PR\n${stderr}`);
    }
  } else {
    const result = await $`gh pr view ${wt.branch} --web`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      if (stderr.includes("no pull requests found")) {
        throw new Error(`No PR found for branch '${wt.branch}'. Use 'gwt pr create' to create one.`);
      }
      throw new Error(`Error: Failed to view PR\n${stderr}`);
    }
  }
}
