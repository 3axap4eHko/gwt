use std::ffi::OsString;
use std::fs;

use crate::AppResult;
use crate::repo::{AGENTS_MD, detect_default_branch, find_gwt_root, get_gwt_config, git};

pub fn run(args: &[OsString]) -> AppResult<()> {
    if !args.is_empty() {
        return Err("Error: init does not accept arguments".to_string());
    }

    let root = find_gwt_root(None).ok_or_else(|| {
        "Error: No .bare directory found\nRun this command from a bare worktree repository root or inside a worktree".to_string()
    })?;
    let config = get_gwt_config(&root);
    let current_version = env!("CARGO_PKG_VERSION");

    if let Some(config) = &config {
        if let Some(version) = &config.version {
            if version == current_version {
                println!("Already initialized (v{})", version);
                return Ok(());
            }
            println!("Upgrading from v{} to v{}...", version, current_version);
        } else {
            println!("Initializing gwt...");
        }
    } else {
        println!("Initializing gwt...");
    }

    let git_file = root.join(".git");
    if !git_file.exists() {
        fs::write(&git_file, "gitdir: ./.bare\n").map_err(|error| error.to_string())?;
        println!("  Created .git file");
    }

    let agents_file = root.join("AGENTS.md");
    if !agents_file.exists() {
        fs::write(&agents_file, AGENTS_MD).map_err(|error| error.to_string())?;
        println!("  Created AGENTS.md");
    }

    let config_fetch = git(
        [
            OsString::from("config"),
            OsString::from("remote.origin.fetch"),
            OsString::from("+refs/heads/*:refs/remotes/origin/*"),
        ],
        Some(&root),
    )?;
    if config_fetch.exit_code != 0 {
        return Err("Error: Failed to configure fetch refspec".to_string());
    }
    let config_prune = git(
        [
            OsString::from("config"),
            OsString::from("fetch.prune"),
            OsString::from("true"),
        ],
        Some(&root),
    )?;
    if config_prune.exit_code != 0 {
        return Err(format!("Error: Failed to configure fetch.prune\n{}", config_prune.stderr.trim()));
    }

    if config.as_ref().and_then(|value| value.default_branch.clone()).is_none() {
        let detected = detect_default_branch(&root)?;
        let configured = git(
            [
                OsString::from("config"),
                OsString::from("gwt.defaultBranch"),
                OsString::from(&detected),
            ],
            Some(&root),
        )?;
        if configured.exit_code != 0 {
            return Err(format!(
                "Error: Failed to set gwt.defaultBranch\n{}",
                configured.stderr.trim()
            ));
        }
        println!("  Default branch: {}", detected);
    }

    let config_version = git(
        [
            OsString::from("config"),
            OsString::from("gwt.version"),
            OsString::from(current_version),
        ],
        Some(&root),
    )?;
    if config_version.exit_code != 0 {
        return Err(format!("Error: Failed to set gwt.version\n{}", config_version.stderr.trim()));
    }

    println!();
    println!("Done! Repository initialized for gwt v{}", current_version);
    Ok(())
}
