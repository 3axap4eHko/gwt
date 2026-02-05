import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, parseWorktreeList } from "../core/repo";

export async function list(): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    console.error(`Error: ${check.error}`);
    process.exit(1);
  }

  const root = findGwtRoot()!;

  process.chdir(root);

  const result = await $`git worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error("Error: Failed to list worktrees");
    process.exit(1);
  }

  const worktrees = parseWorktreeList(result.stdout.toString());
  const filtered = worktrees.filter(wt => !wt.isBare);

  if (filtered.length === 0) {
    console.log("No worktrees found");
    return;
  }

  const maxName = Math.max(...filtered.map(wt => wt.name.length));

  for (const wt of filtered) {
    const name = wt.name.padEnd(maxName);
    const branch = wt.branch ?? "(detached)";
    const shortCommit = wt.commit?.slice(0, 7) ?? "";
    console.log(`${name}  ${shortCommit}  ${branch}`);
  }
}
