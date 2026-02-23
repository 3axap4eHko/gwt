import { $ } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import { findGwtRoot, getGwtConfig, getCurrentVersion, detectDefaultBranch } from "../core/repo";
import agentsMdPath from "../templates/AGENTS.md" with { type: "file" };

export async function init(): Promise<void> {
  const root = findGwtRoot();

  if (!root) {
    throw new Error("Error: No .bare directory found\nRun this command from a bare worktree repository root or inside a worktree");
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
    throw new Error("Error: Failed to configure fetch refspec");
  }
  const configPrune = await $`git config fetch.prune true`.quiet().nothrow();
  if (configPrune.exitCode !== 0) {
    throw new Error(`Error: Failed to configure fetch.prune\n${configPrune.stderr.toString()}`);
  }

  // Detect default branch if not set
  let defaultBranch = config?.defaultBranch;
  if (!defaultBranch) {
    defaultBranch = await detectDefaultBranch();
    const configBranch = await $`git config gwt.defaultBranch ${defaultBranch}`.quiet().nothrow();
    if (configBranch.exitCode !== 0) {
      throw new Error(`Error: Failed to set gwt.defaultBranch\n${configBranch.stderr.toString()}`);
    }
    console.log(`  Default branch: ${defaultBranch}`);
  }

  // Set version
  const configVersion = await $`git config gwt.version ${getCurrentVersion()}`.quiet().nothrow();
  if (configVersion.exitCode !== 0) {
    throw new Error(`Error: Failed to set gwt.version\n${configVersion.stderr.toString()}`);
  }

  console.log("");
  console.log(`Done! Repository initialized for gwt v${getCurrentVersion()}`);
}
