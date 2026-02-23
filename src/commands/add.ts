import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import { findGwtRoot, getDefaultBranch, checkGwtSetup } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

interface AddOptions {
  from?: string;
  noFetch?: boolean;
}

export async function add(name: string, options: AddOptions = {}): Promise<void> {
  if (!isValidWorktreeName(name)) {
    throw new Error("Error: Invalid worktree name");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;

  const worktreePath = resolve(root, name);

  if (existsSync(worktreePath)) {
    throw new Error(`Error: Directory '${name}' already exists`);
  }

  process.chdir(root);

  if (!options.noFetch) {
    console.log("Fetching remotes...");
    const fetch = await $`git fetch --all`.quiet().nothrow();
    if (fetch.exitCode !== 0) {
      console.error("Warning: Failed to fetch remotes");
    }
  }

  // Determine source branch
  const fromBranch = options.from ?? getDefaultBranch() ?? "master";

  const [remoteRef, localBranchExists] = await Promise.all([
    findRemoteBranch(name),
    branchExistsLocally(name),
  ]);

  let cmd: string[];

  if (localBranchExists) {
    console.log(`Creating worktree '${name}' from existing branch...`);
    cmd = ["git", "worktree", "add", name, name];
  } else if (remoteRef) {
    console.log(`Creating worktree '${name}' tracking remote branch...`);
    cmd = ["git", "worktree", "add", "--track", "-b", name, name, remoteRef];
  } else {
    // New branch
    console.log(`Creating worktree '${name}' as new branch from '${fromBranch}'...`);
    cmd = ["git", "worktree", "add", "-b", name, name, fromBranch];
  }

  const result = await $`${cmd}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    throw new Error(`Error: Failed to create worktree\n${result.stderr.toString()}`);
  }

  console.log("");
  console.log(`Done! Worktree created at ${name}/`);
  console.log(`  cd ${name}`);
}

async function findRemoteBranch(name: string): Promise<string | null> {
  const result = await $`git for-each-ref --format=%(refname:short) refs/remotes`.quiet().nothrow();
  if (result.exitCode !== 0) return null;

  const refs = result.stdout
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

async function branchExistsLocally(name: string): Promise<boolean> {
  const result = await $`git show-ref --verify refs/heads/${name}`.quiet().nothrow();
  return result.exitCode === 0;
}
