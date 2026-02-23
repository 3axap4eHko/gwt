import { $ } from "bun";
import { resolve, relative, isAbsolute } from "path";
import { findGwtRoot, checkGwtSetup } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

export async function lock(name: string, reason?: string): Promise<void> {
  if (!isValidWorktreeName(name)) {
    throw new Error("Error: Invalid worktree name");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const cmd = reason
    ? ["git", "worktree", "lock", name, "--reason", reason]
    : ["git", "worktree", "lock", name];

  const result = await $`${cmd}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Error: Failed to lock worktree\n${stderr}`);
  }

  console.log(`Locked '${name}'${reason ? `: ${reason}` : ""}`);
}

export async function unlock(name: string): Promise<void> {
  if (!isValidWorktreeName(name)) {
    throw new Error("Error: Invalid worktree name");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const result = await $`git worktree unlock ${name}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Error: Failed to unlock worktree\n${stderr}`);
  }

  console.log(`Unlocked '${name}'`);
}

export async function move(name: string, newPath: string): Promise<void> {
  if (!isValidWorktreeName(name)) {
    throw new Error("Error: Invalid worktree name");
  }

  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  const dest = resolve(root, newPath);
  const rel = relative(root, dest);
  if (rel === "" || isAbsolute(rel) || rel.startsWith("..")) {
    throw new Error("Error: Destination must be inside the repo root");
  }

  process.chdir(root);

  const result = await $`git worktree move ${name} ${dest}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Error: Failed to move worktree\n${stderr}`);
  }

  console.log(`Moved '${name}' to '${newPath}'`);
}
