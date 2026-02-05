import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import { findGwtRoot, getGwtConfig, getCurrentVersion, detectDefaultBranch } from "../core/repo";
import agentsMdPath from "../templates/AGENTS.md" with { type: "file" };

export async function init(): Promise<void> {
  const root = findGwtRoot();

  if (!root) {
    console.error("Error: No .bare directory found");
    console.error("Run this command from a bare worktree repository root or inside a worktree");
    process.exit(1);
  }

  process.chdir(root);

  const config = getGwtConfig();

  if (config?.version) {
    const currentVersion = getCurrentVersion();
    if (config.version === currentVersion) {
      console.log(`Already initialized (v${config.version})`);
      return;
    }
    console.log(`Upgrading from v${config.version} to v${currentVersion}...`);
  } else {
    console.log("Initializing gwt...");
  }

  // Ensure .git file exists
  const gitFile = resolve(root, ".git");
  if (!existsSync(gitFile)) {
    await Bun.write(gitFile, "gitdir: ./.bare\n");
    console.log("  Created .git file");
  }

  // Create AGENTS.md if missing
  const agentsFile = resolve(root, "AGENTS.md");
  if (!existsSync(agentsFile)) {
    const agentsMd = await Bun.file(agentsMdPath).text();
    await Bun.write(agentsFile, agentsMd);
    console.log("  Created AGENTS.md");
  }

  // Ensure fetch config is set
  const configFetch = await $`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"`.quiet().nothrow();
  if (configFetch.exitCode !== 0) {
    console.error("Error: Failed to configure fetch refspec");
    process.exit(1);
  }
  await $`git config fetch.prune true`.quiet().nothrow();

  // Detect default branch if not set
  let defaultBranch = config?.defaultBranch;
  if (!defaultBranch) {
    defaultBranch = await detectDefaultBranch();
    await $`git config gwt.defaultBranch ${defaultBranch}`.quiet().nothrow();
    console.log(`  Default branch: ${defaultBranch}`);
  }

  // Set version
  await $`git config gwt.version ${getCurrentVersion()}`.quiet().nothrow();

  console.log("");
  console.log(`Done! Repository initialized for gwt v${getCurrentVersion()}`);
}
