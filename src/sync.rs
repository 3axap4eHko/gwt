use std::ffi::OsString;

use crate::AppResult;
use crate::arg_to_str;
use crate::cd::{resolve_worktree, select_worktree};
use crate::repo::{ensure_gwt_setup, get_worktrees, git, git_in_worktree};

pub fn run(args: &[OsString]) -> AppResult<()> {
    let (name, no_fetch) = parse_options(args)?;
    let root = ensure_gwt_setup()?;

    if !no_fetch {
        println!("Fetching remotes...");
        let fetch = git(["fetch", "--all"], Some(&root))?;
        if fetch.exit_code != 0 {
            eprintln!("Warning: Failed to fetch remotes");
        }
    }

    let worktrees = get_worktrees(&root)?;
    if worktrees.is_empty() {
        return Err("No worktrees found".to_string());
    }

    let worktree = if let Some(name) = name.as_deref() {
        resolve_worktree(&worktrees, name)?.clone()
    } else {
        select_worktree(&worktrees)?
    };

    println!("Syncing '{}'...", worktree.name);
    let result = git_in_worktree(&worktree.path, &["pull", "--rebase"])?;
    if result.exit_code != 0 {
        return Err(format!("Error: Failed to sync\n{}", result.stderr.trim()));
    }
    if !result.stdout.trim().is_empty() {
        println!("{}", result.stdout.trim());
    }
    println!("Done! '{}' is up to date", worktree.name);
    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<(Option<String>, bool)> {
    let mut name = None;
    let mut no_fetch = false;
    for arg in args {
        match arg_to_str(arg)? {
            "-n" | "--no-fetch" => no_fetch = true,
            value if value.starts_with('-') => return Err(format!("Error: unknown sync option '{value}'")),
            value => {
                if name.is_some() {
                    return Err("Error: sync accepts at most one worktree name".to_string());
                }
                name = Some(value.to_string());
            }
        }
    }
    Ok((name, no_fetch))
}
