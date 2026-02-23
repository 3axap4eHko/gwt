import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, parseWorktreeList, formatAge } from "../core/repo";

interface ListOptions {
  json?: boolean;
  names?: boolean;
}

export async function list(options: ListOptions = {}): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;

  process.chdir(root);

  const result = await $`git worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error("Error: Failed to list worktrees");
  }

  const worktrees = parseWorktreeList(result.stdout.toString());
  const filtered = worktrees.filter(wt => !wt.isBare);

  if (filtered.length === 0) {
    console.log("No worktrees found");
    return;
  }

  if (options.names) {
    for (const wt of filtered) {
      console.log(wt.name);
    }
    return;
  }

  const enriched = await Promise.all(
    filtered.map(async (wt) => {
      const [statusResult, stat] = await Promise.all([
        $`git -C ${wt.path} status --porcelain`.quiet().nothrow(),
        Bun.file(wt.path).stat().catch(() => null),
      ]);
      const dirty = statusResult.exitCode === 0 && statusResult.stdout.toString().trim().length > 0;
      const mtime = stat?.mtime?.getTime() ?? 0;
      return { ...wt, dirty, mtime };
    })
  );

  if (options.json) {
    const jsonOutput = enriched.map(wt => ({
      name: wt.name,
      path: wt.path,
      commit: wt.commit ?? null,
      branch: wt.branch,
      dirty: wt.dirty,
      locked: wt.locked !== undefined,
      ...(wt.locked ? { lockReason: wt.locked } : {}),
      age: formatAge(wt.mtime),
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const maxName = Math.max(...enriched.map(wt => wt.name.length));

  for (const wt of enriched) {
    const name = wt.name.padEnd(maxName);
    const branch = wt.branch ?? "(detached)";
    const shortCommit = wt.commit?.slice(0, 7) ?? "";
    const flags: string[] = [];
    if (wt.dirty) flags.push("dirty");
    if (wt.locked !== undefined) flags.push("locked");
    const status = flags.length > 0 ? `[${flags.join(", ")}]` : "";
    const age = formatAge(wt.mtime);

    const parts = [name, shortCommit, branch];
    if (status) parts.push(status);
    if (age) parts.push(age);
    console.log(parts.join("  "));
  }
}
