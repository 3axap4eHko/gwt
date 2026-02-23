import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, getWorktrees } from "../core/repo";
import { resolveWorktree, selectWorktree } from "./cd";

export async function mr(action?: string, name?: string): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const glabCheck = await $`command -v glab`.quiet().nothrow();
  if (glabCheck.exitCode !== 0) {
    throw new Error("Error: 'glab' CLI not found. Install it from https://gitlab.com/gitlab-org/cli");
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
    console.log(`Creating MR for '${wt.branch}'...`);
    const result = await $`glab mr create --web --source-branch ${wt.branch}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(`Error: Failed to create MR\n${stderr}`);
    }
  } else {
    const result = await $`glab mr view ${wt.branch} --web`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      if (stderr.includes("no merge request found") || stderr.includes("no open merge request")) {
        throw new Error(`No MR found for branch '${wt.branch}'. Use 'gwt mr create' to create one.`);
      }
      throw new Error(`Error: Failed to view MR\n${stderr}`);
    }
  }
}
