import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, getWorktrees, debug } from "../core/repo";
import { resolveWorktree, selectWorktree } from "./cd";

interface SyncOptions {
  noFetch?: boolean;
}

export async function sync(name?: string, options: SyncOptions = {}): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  if (!options.noFetch) {
    console.log("Fetching remotes...");
    const fetch = await $`git fetch --all`.quiet().nothrow();
    if (fetch.exitCode !== 0) {
      console.error("Warning: Failed to fetch remotes");
    }
  }

  const worktrees = await getWorktrees();
  if (worktrees.length === 0) {
    throw new Error("No worktrees found");
  }

  const wt = name ? resolveWorktree(worktrees, name) : await selectWorktree(worktrees);

  debug("sync", { name: wt.name, path: wt.path, branch: wt.branch });
  console.log(`Syncing '${wt.name}'...`);
  const result = await $`git -C ${wt.path} pull --rebase`.quiet().nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Error: Failed to sync\n${stderr}`);
  }

  const output = result.stdout.toString().trim();
  if (output) {
    console.log(output);
  }
  console.log(`Done! '${wt.name}' is up to date`);
}
