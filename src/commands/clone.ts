import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { basename, resolve } from "path";
import { getCurrentVersion, detectDefaultBranch } from "../core/repo";
import agentsMdPath from "../templates/AGENTS.md" with { type: "file" };

export async function clone(url: string, dest?: string): Promise<void> {
  const repoName = dest ?? basename(url, ".git").replace(/\.git$/, "");
  const targetDir = resolve(process.cwd(), repoName);

  if (existsSync(targetDir)) {
    console.error(`Error: Directory '${repoName}' already exists`);
    process.exit(1);
  }

  console.log(`Cloning ${url} into ${repoName}/`);

  mkdirSync(targetDir, { recursive: true });
  process.chdir(targetDir);

  // Clone as bare repository
  console.log("  Creating bare repository...");
  const cloneResult = await $`git clone --bare ${url} .bare`.quiet().nothrow();
  if (cloneResult.exitCode !== 0) {
    console.error(`Error: Failed to clone repository`);
    console.error(cloneResult.stderr.toString());
    process.exit(1);
  }

  // Create .git file pointing to .bare
  await Bun.write(".git", "gitdir: ./.bare\n");

  // Configure fetch refspec for bare repo
  console.log("  Configuring repository...");
  const configFetch = await $`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.quiet().nothrow();
  if (configFetch.exitCode !== 0) {
    console.error("Error: Failed to configure fetch refspec");
    process.exit(1);
  }
  await $`git config fetch.prune true`.quiet().nothrow();

  // Fetch all branches
  console.log("  Fetching branches...");
  const fetchResult = await $`git fetch origin`.quiet().nothrow();
  if (fetchResult.exitCode !== 0) {
    console.error("Error: Failed to fetch branches");
    console.error(fetchResult.stderr.toString());
    process.exit(1);
  }

  // Detect and save default branch + mark as gwt-managed
  const defaultBranch = await detectDefaultBranch();
  await $`git config gwt.version ${getCurrentVersion()}`.quiet().nothrow();
  await $`git config gwt.defaultBranch ${defaultBranch}`.quiet().nothrow();
  console.log(`  Default branch: ${defaultBranch}`);

  // Create initial worktree
  console.log(`  Creating worktree '${defaultBranch}'...`);
  const wtResult = await $`git worktree add ${defaultBranch} ${defaultBranch}`.quiet().nothrow();
  if (wtResult.exitCode !== 0) {
    console.error(`Error: Failed to create worktree`);
    console.error(wtResult.stderr.toString());
    process.exit(1);
  }

  // Create AGENTS.md
  const agentsMd = await Bun.file(agentsMdPath).text();
  await Bun.write("AGENTS.md", agentsMd);

  console.log("");
  console.log(`Done! Repository cloned to ${repoName}/`);
  console.log(`  cd ${repoName}/${defaultBranch}`);
}
