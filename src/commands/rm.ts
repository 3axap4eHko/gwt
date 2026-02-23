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
    throw new Error("Error: Invalid worktree name");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;

  const worktreePath = resolve(root, name);

  if (!existsSync(worktreePath)) {
    throw new Error(`Error: Worktree '${name}' not found`);
  }

  process.chdir(root);

  // Safety checks (skip with --force)
  if (!options.force) {
    const issues = await checkSafety(name, worktreePath);
    if (issues.length > 0) {
      const lines = [
        "Cannot remove worktree due to safety checks:\n",
        ...issues.map(issue => `  - ${issue}`),
        "\nUse --force to override (at your own risk)",
      ];
      throw new Error(lines.join("\n"));
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
        throw new Error(`Error: Failed to remove worktree\n${forceResult.stderr.toString()}`);
      }
    } else {
      throw new Error(`Error: Failed to remove worktree\n${result.stderr.toString()}\n\nUse --force to override`);
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

async function findTrackingRef(name: string): Promise<string | null> {
  const upstreamFmt = "%(upstream:short)";
  const upstream = await $`git for-each-ref --format=${upstreamFmt} refs/heads/${name}`.quiet().nothrow();
  if (upstream.exitCode === 0) {
    const trackingRef = upstream.stdout.toString().trim();
    if (trackingRef) return trackingRef;
  }

  const refFmt = "%(refname:short)";
  const scan = await $`git for-each-ref --format=${refFmt} refs/remotes`.quiet().nothrow();
  if (scan.exitCode !== 0) return null;

  const refs = scan.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(r => r.endsWith(`/${name}`) && !r.endsWith("/HEAD"));

  if (refs.length === 0) return null;

  const validated = await Promise.all(
    refs.map(async (ref) => {
      const remote = ref.slice(0, -(name.length + 1));
      if (!remote) return null;
      const remoteExists = await $`git remote get-url ${remote}`.quiet().nothrow();
      return remoteExists.exitCode === 0 ? ref : null;
    })
  );

  const validRefs = validated.filter((ref): ref is string => ref !== null);
  if (validRefs.length === 0) return null;

  return validRefs.find(r => r === `origin/${name}`) ?? validRefs[0];
}

async function checkSafety(name: string, worktreePath: string): Promise<string[]> {
  const issues: string[] = [];

  const defaultBranch = getDefaultBranch();
  if (defaultBranch && name === defaultBranch) {
    issues.push(`'${name}' is the default branch`);
  }

  const [statusResult, trackingRef] = await Promise.all([
    $`git -C ${worktreePath} status --porcelain`.quiet().nothrow(),
    findTrackingRef(name),
  ]);

  if (statusResult.exitCode !== 0) {
    issues.push("Failed to check worktree status");
  } else if (statusResult.stdout.toString().trim().length > 0) {
    issues.push("Uncommitted changes in worktree");
  }

  if (!trackingRef) {
    issues.push(`Branch '${name}' not pushed to remote`);
  } else {
    const fetchResult = await $`git fetch --all`.quiet().nothrow();

    if (fetchResult.exitCode !== 0) {
      issues.push("Failed to fetch from remote");
    } else {
      const [aheadResult, behindResult] = await Promise.all([
        $`git -C ${worktreePath} rev-list --count ${trackingRef}..HEAD`.quiet().nothrow(),
        $`git -C ${worktreePath} rev-list --count HEAD..${trackingRef}`.quiet().nothrow(),
      ]);

      if (aheadResult.exitCode !== 0) {
        issues.push("Failed to check unpushed commits");
      } else {
        const ahead = parseInt(aheadResult.stdout.toString().trim(), 10);
        if (ahead > 0) {
          issues.push(`${ahead} unpushed commit${ahead > 1 ? "s" : ""}`);
        }
      }

      if (behindResult.exitCode !== 0) {
        issues.push("Failed to check commits behind remote");
      } else {
        const behind = parseInt(behindResult.stdout.toString().trim(), 10);
        if (behind > 0) {
          issues.push(`${behind} commit${behind > 1 ? "s" : ""} behind remote`);
        }
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
