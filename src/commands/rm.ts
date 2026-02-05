import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import { findGwtRoot, getDefaultBranch, checkGwtSetup } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

interface RmOptions {
  force?: boolean;
}

export async function rm(name: string, options: RmOptions = {}): Promise<void> {
  if (!isValidWorktreeName(name)) {
    console.error("Error: Invalid worktree name");
    process.exit(1);
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    console.error(`Error: ${check.error}`);
    process.exit(1);
  }

  const root = findGwtRoot()!;

  const worktreePath = resolve(root, name);

  if (!existsSync(worktreePath)) {
    console.error(`Error: Worktree '${name}' not found`);
    process.exit(1);
  }

  process.chdir(root);

  // Safety checks (skip with --force)
  if (!options.force) {
    const issues = await checkSafety(name, worktreePath);
    if (issues.length > 0) {
      console.error("Cannot remove worktree due to safety checks:\n");
      for (const issue of issues) {
        console.error(`  - ${issue}`);
      }
      console.error("\nUse --force to override (at your own risk)");
      process.exit(1);
    }
  }

  // Remove worktree
  console.log(`Removing worktree '${name}'...`);
  const result = await $`git worktree remove ${name}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    // Try with --force if regular remove fails (e.g., untracked files)
    if (options.force) {
      const forceResult = await $`git worktree remove --force ${name}`.quiet().nothrow();
      if (forceResult.exitCode !== 0) {
        console.error("Error: Failed to remove worktree");
        console.error(forceResult.stderr.toString());
        process.exit(1);
      }
    } else {
      console.error("Error: Failed to remove worktree");
      console.error(result.stderr.toString());
      console.error("\nUse --force to override");
      process.exit(1);
    }
  }

  // Delete branch if it was created by gwt (not a tracking branch)
  const branchDeleted = await tryDeleteBranch(name);

  console.log("");
  console.log(`Done! Worktree '${name}' removed`);
  if (branchDeleted) {
    console.log(`  Branch '${name}' also deleted`);
  }
}

async function checkSafety(name: string, worktreePath: string): Promise<string[]> {
  const issues: string[] = [];

  // Check if it's the default branch
  const defaultBranch = getDefaultBranch();
  if (defaultBranch && name === defaultBranch) {
    issues.push(`'${name}' is the default branch`);
  }

  // Run independent checks in parallel
  const [statusResult, remoteRef] = await Promise.all([
    $`git -C ${worktreePath} status --porcelain`.quiet().nothrow(),
    $`git ls-remote --heads origin ${name}`.quiet().nothrow(),
  ]);

  if (statusResult.exitCode === 0 && statusResult.stdout.toString().trim().length > 0) {
    issues.push("Uncommitted changes in worktree");
  }

  const existsOnRemote = remoteRef.exitCode === 0 && remoteRef.stdout.toString().trim().length > 0;

  if (!existsOnRemote) {
    issues.push(`Branch '${name}' not pushed to remote`);
  } else {
    await $`git fetch origin ${name}`.quiet().nothrow();

    const [aheadResult, behindResult] = await Promise.all([
      $`git -C ${worktreePath} rev-list --count origin/${name}..HEAD`.quiet().nothrow(),
      $`git -C ${worktreePath} rev-list --count HEAD..origin/${name}`.quiet().nothrow(),
    ]);

    if (aheadResult.exitCode === 0) {
      const ahead = parseInt(aheadResult.stdout.toString().trim(), 10);
      if (ahead > 0) {
        issues.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);
      }
    }

    if (behindResult.exitCode === 0) {
      const behind = parseInt(behindResult.stdout.toString().trim(), 10);
      if (behind > 0) {
        issues.push(`${behind} commit${behind > 1 ? "s" : ""} behind remote`);
      }
    }
  }

  return issues;
}

async function tryDeleteBranch(name: string): Promise<boolean> {
  // Don't delete the default branch
  const defaultBranch = getDefaultBranch();
  if (defaultBranch && name === defaultBranch) {
    return false;
  }

  // Try to delete the branch
  const result = await $`git branch -d ${name}`.quiet().nothrow();
  return result.exitCode === 0;
}
