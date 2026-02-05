import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import { findGwtRoot, getDefaultBranch, checkGwtSetup } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

interface AddOptions {
  from?: string;
}

export async function add(name: string, options: AddOptions = {}): Promise<void> {
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

  if (existsSync(worktreePath)) {
    console.error(`Error: Directory '${name}' already exists`);
    process.exit(1);
  }

  process.chdir(root);

  // Determine source branch
  const fromBranch = options.from ?? getDefaultBranch() ?? "master";

  // Check if branch exists on remote or locally
  const [remoteBranchExists, localBranchExists] = await Promise.all([
    branchExistsOnRemote(name),
    branchExistsLocally(name),
  ]);

  let cmd: string[];

  if (localBranchExists) {
    // Branch exists locally, just create worktree
    console.log(`Creating worktree '${name}' from existing branch...`);
    cmd = ["git", "worktree", "add", name, name];
  } else if (remoteBranchExists) {
    // Branch exists on remote, create tracking branch
    console.log(`Creating worktree '${name}' tracking remote branch...`);
    cmd = ["git", "worktree", "add", "--track", "-b", name, name, `origin/${name}`];
  } else {
    // New branch
    console.log(`Creating worktree '${name}' as new branch from '${fromBranch}'...`);
    cmd = ["git", "worktree", "add", "-b", name, name, fromBranch];
  }

  const result = await $`${cmd}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    console.error("Error: Failed to create worktree");
    console.error(result.stderr.toString());
    process.exit(1);
  }

  console.log("");
  console.log(`Done! Worktree created at ${name}/`);
  console.log(`  cd ${name}`);
}

async function branchExistsOnRemote(name: string): Promise<boolean> {
  const result = await $`git ls-remote --heads origin ${name}`.quiet().nothrow();
  return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
}

async function branchExistsLocally(name: string): Promise<boolean> {
  const result = await $`git show-ref --verify refs/heads/${name}`.quiet().nothrow();
  return result.exitCode === 0;
}
