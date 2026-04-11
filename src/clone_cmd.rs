use std::ffi::OsString;
use std::fs;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{AGENTS_MD, detect_default_branch, git, path_arg};

pub fn run(args: &[OsString]) -> AppResult<()> {
    let url = args
        .first()
        .ok_or_else(|| "Error: clone requires a repository URL".to_string())
        .and_then(|value| arg_to_str(value).map(|text| text.to_string()))?;
    let dest = args
        .get(1)
        .map(|value| arg_to_str(value).map(|text| text.to_string()))
        .transpose()?;

    if args.len() > 2 {
        return Err("Error: clone accepts at most two positional arguments".to_string());
    }

    let repo_name = dest.unwrap_or_else(|| repo_name_from_url(&url));
    let target_dir = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join(&repo_name);

    if target_dir.exists() {
        return Err(format!("Error: Directory '{}' already exists", repo_name));
    }

    println!("Cloning {} into {}/", url, repo_name);
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

    println!("  Creating bare repository...");
    let clone = git(
        [
            OsString::from("clone"),
            OsString::from("--bare"),
            OsString::from(url),
            OsString::from(".bare"),
        ],
        Some(&target_dir),
    )?;
    if clone.exit_code != 0 {
        return Err(format!(
            "Error: Failed to clone repository\n{}",
            clone.stderr.trim()
        ));
    }

    fs::write(target_dir.join(".git"), "gitdir: ./.bare\n").map_err(|error| error.to_string())?;

    println!("  Configuring repository...");
    let fetch = git(
        [
            OsString::from("config"),
            OsString::from("remote.origin.fetch"),
            OsString::from("+refs/heads/*:refs/remotes/origin/*"),
        ],
        Some(&target_dir),
    )?;
    if fetch.exit_code != 0 {
        return Err("Error: Failed to configure fetch refspec".to_string());
    }

    let prune = git(
        [
            OsString::from("config"),
            OsString::from("fetch.prune"),
            OsString::from("true"),
        ],
        Some(&target_dir),
    )?;
    if prune.exit_code != 0 {
        return Err(format!(
            "Error: Failed to configure fetch.prune\n{}",
            prune.stderr.trim()
        ));
    }

    println!("  Fetching branches...");
    let fetched = git(["fetch", "origin"], Some(&target_dir))?;
    if fetched.exit_code != 0 {
        return Err(format!(
            "Error: Failed to fetch branches\n{}",
            fetched.stderr.trim()
        ));
    }

    let default_branch = detect_default_branch(&target_dir)?;
    let version = env!("CARGO_PKG_VERSION");
    let config_version = git(
        [
            OsString::from("config"),
            OsString::from("gwt.version"),
            OsString::from(version),
        ],
        Some(&target_dir),
    )?;
    if config_version.exit_code != 0 {
        return Err(format!(
            "Error: Failed to set gwt.version\n{}",
            config_version.stderr.trim()
        ));
    }
    let config_branch = git(
        [
            OsString::from("config"),
            OsString::from("gwt.defaultBranch"),
            OsString::from(&default_branch),
        ],
        Some(&target_dir),
    )?;
    if config_branch.exit_code != 0 {
        return Err(format!(
            "Error: Failed to set gwt.defaultBranch\n{}",
            config_branch.stderr.trim()
        ));
    }
    println!("  Default branch: {}", default_branch);

    println!("  Creating worktree '{}'...", default_branch);
    let worktree = git(
        [
            OsString::from("worktree"),
            OsString::from("add"),
            path_arg(&target_dir.join(&default_branch))?,
            OsString::from(&default_branch),
        ],
        Some(&target_dir),
    )?;
    if worktree.exit_code != 0 {
        return Err(format!(
            "Error: Failed to create worktree\n{}",
            worktree.stderr.trim()
        ));
    }

    let _ = git(
        [
            OsString::from("branch"),
            OsString::from(format!("--set-upstream-to=origin/{}", default_branch)),
            OsString::from(&default_branch),
        ],
        Some(&target_dir),
    )?;

    fs::write(target_dir.join("AGENTS.md"), AGENTS_MD).map_err(|error| error.to_string())?;

    println!();
    println!("Done! Repository cloned to {}/", repo_name);
    println!("  cd {}/{}", repo_name, default_branch);
    Ok(())
}

fn repo_name_from_url(url: &str) -> String {
    let name = url.rsplit('/').next().unwrap_or(url);
    name.trim_end_matches(".git").to_string()
}
