import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, parseWorktreeList, formatAge } from "../core/repo";

interface ListOptions {
  json?: boolean;
  names?: boolean;
  clean?: boolean;
  dirty?: boolean;
  synced?: boolean;
  ahead?: boolean;
  behind?: boolean;
  noRemote?: boolean;
  noFetch?: boolean;
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

  const hasFilters = options.clean || options.dirty || options.synced || options.ahead || options.behind || options.noRemote;
  const needsSync = options.synced || options.ahead || options.behind || options.noRemote;

  if (needsSync && !options.noFetch) {
    const fetch = await $`git fetch --all`.quiet().nothrow();
    if (fetch.exitCode !== 0) {
      console.error("Warning: Failed to fetch remotes");
    }
  }

  if (options.names && !hasFilters) {
    for (const wt of filtered) {
      console.log(wt.name);
    }
    return;
  }

  const upstreamFmt = "%(upstream:short)";
  const enriched = await Promise.all(
    filtered.map(async (wt) => {
      const statusPromise = $`git -C ${wt.path} status --porcelain`.quiet().nothrow();
      const statPromise = Bun.file(wt.path).stat().catch(() => null);

      let syncStatus: "no-remote" | "synced" | "ahead" | "behind" | "diverged" = "no-remote";
      let syncChecked = false;

      if (needsSync && wt.branch) {
        syncChecked = true;
        const upstreamResult = await $`git for-each-ref --format=${upstreamFmt} refs/heads/${wt.branch}`.quiet().nothrow();
        const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.toString().trim() : "";
        if (upstream) {
          const [aheadResult, behindResult] = await Promise.all([
            $`git -C ${wt.path} rev-list --count ${upstream}..HEAD`.quiet().nothrow(),
            $`git -C ${wt.path} rev-list --count HEAD..${upstream}`.quiet().nothrow(),
          ]);
          const aheadCount = aheadResult.exitCode === 0 ? parseInt(aheadResult.stdout.toString().trim(), 10) : 0;
          const behindCount = behindResult.exitCode === 0 ? parseInt(behindResult.stdout.toString().trim(), 10) : 0;
          if (aheadCount > 0 && behindCount > 0) syncStatus = "diverged";
          else if (aheadCount > 0) syncStatus = "ahead";
          else if (behindCount > 0) syncStatus = "behind";
          else syncStatus = "synced";
        }
      }

      const [statusResult, stat] = await Promise.all([statusPromise, statPromise]);
      const dirty = statusResult.exitCode === 0 && statusResult.stdout.toString().trim().length > 0;
      const mtime = stat?.mtime?.getTime() ?? 0;
      return { ...wt, dirty, mtime, syncStatus, syncChecked };
    })
  );

  let results = enriched;

  if (hasFilters) {
    results = results.filter(wt => {
      if (options.clean && wt.dirty) return false;
      if (options.dirty && !wt.dirty) return false;
      if (options.synced && wt.syncStatus !== "synced") return false;
      if (options.ahead && wt.syncStatus !== "ahead" && wt.syncStatus !== "diverged") return false;
      if (options.behind && wt.syncStatus !== "behind" && wt.syncStatus !== "diverged") return false;
      if (options.noRemote && wt.syncStatus !== "no-remote") return false;
      return true;
    });
  }

  if (options.names) {
    for (const wt of results) {
      console.log(wt.name);
    }
    return;
  }

  if (results.length === 0) {
    console.log("No matching worktrees");
    return;
  }

  if (options.json) {
    const jsonOutput = results.map(wt => ({
      name: wt.name,
      path: wt.path,
      commit: wt.commit ?? null,
      branch: wt.branch,
      dirty: wt.dirty,
      locked: wt.locked !== undefined,
      ...(wt.locked ? { lockReason: wt.locked } : {}),
      ...(wt.syncChecked ? { sync: wt.syncStatus } : {}),
      age: formatAge(wt.mtime),
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const maxName = Math.max(...results.map(wt => wt.name.length));

  for (const wt of results) {
    const name = wt.name.padEnd(maxName);
    const branch = wt.branch ?? "(detached)";
    const shortCommit = wt.commit?.slice(0, 7) ?? "";
    const flags: string[] = [];
    if (wt.dirty) flags.push("dirty");
    if (wt.locked !== undefined) flags.push("locked");
    if (wt.syncChecked && wt.syncStatus !== "synced") flags.push(wt.syncStatus);
    const status = flags.length > 0 ? `[${flags.join(", ")}]` : "";
    const age = formatAge(wt.mtime);

    const parts = [name, shortCommit, branch];
    if (status) parts.push(status);
    if (age) parts.push(age);
    console.log(parts.join("  "));
  }
}
