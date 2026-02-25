import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { basename, resolve } from "path";
import { getCurrentVersion, detectDefaultBranch, debug } from "../core/repo";
import agentsMdPath from "../templates/AGENTS.md" with { type: "file" };

export async function clone(url: string, dest?: string): Promise<void> {
  const repoName = dest ?? basename(url, ".git").replace(/\.git$/, "");
  const targetDir = resolve(process.cwd(), repoName);

  if (existsSync(targetDir)) {
    throw new Error(`Error: Directory '${repoName}' already exists`);
  }

  debug("clone", { url, repoName, targetDir });
  console.log(`Cloning ${url} into ${repoName}/`);

  mkdirSync(targetDir, { recursive: true });
  process.chdir(targetDir);

  // Clone as bare repository
  console.log("  Creating bare repository...");
  const cloneResult = await $`git clone --bare ${url} .bare`.quiet().nothrow();
  if (cloneResult.exitCode !== 0) {
    throw new Error(`Error: Failed to clone repository\n${cloneResult.stderr.toString()}`);
  }

  // Create .git file pointing to .bare
  await Bun.write(".git", "gitdir: ./.bare\n");

  // Configure fetch refspec for bare repo
  console.log("  Configuring repository...");
  const configFetch = await $`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.quiet().nothrow();
  if (configFetch.exitCode !== 0) {
    throw new Error("Error: Failed to configure fetch refspec");
  }
  const configPrune = await $`git config fetch.prune true`.quiet().nothrow();
  if (configPrune.exitCode !== 0) {
    throw new Error(`Error: Failed to configure fetch.prune\n${configPrune.stderr.toString()}`);
  }

  // Fetch all branches
  console.log("  Fetching branches...");
  const fetchResult = await $`git fetch origin`.quiet().nothrow();
  if (fetchResult.exitCode !== 0) {
    throw new Error(`Error: Failed to fetch branches\n${fetchResult.stderr.toString()}`);
  }

  // Detect and save default branch + mark as gwt-managed
  const defaultBranch = await detectDefaultBranch();
  const configVersion = await $`git config gwt.version ${getCurrentVersion()}`.quiet().nothrow();
  if (configVersion.exitCode !== 0) {
    throw new Error(`Error: Failed to set gwt.version\n${configVersion.stderr.toString()}`);
  }
  const configBranch = await $`git config gwt.defaultBranch ${defaultBranch}`.quiet().nothrow();
  if (configBranch.exitCode !== 0) {
    throw new Error(`Error: Failed to set gwt.defaultBranch\n${configBranch.stderr.toString()}`);
  }
  console.log(`  Default branch: ${defaultBranch}`);

  // Create initial worktree
  console.log(`  Creating worktree '${defaultBranch}'...`);
  const wtResult = await $`git worktree add ${defaultBranch} ${defaultBranch}`.quiet().nothrow();
  if (wtResult.exitCode !== 0) {
    throw new Error(`Error: Failed to create worktree\n${wtResult.stderr.toString()}`);
  }

  // Create AGENTS.md
  const agentsMd = await Bun.file(agentsMdPath).text();
  await Bun.write("AGENTS.md", agentsMd);

  console.log("");
  console.log(`Done! Repository cloned to ${repoName}/`);
  console.log(`  cd ${repoName}/${defaultBranch}`);
}
