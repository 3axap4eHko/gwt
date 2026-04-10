use std::ffi::OsString;

use crate::AppResult;
use crate::arg_to_str;
use crate::cd::{resolve_worktree, select_worktree};
use crate::repo::{command_exists, ensure_gwt_setup, get_worktrees, run_command};

pub fn run(args: &[OsString]) -> AppResult<()> {
    if !command_exists("gh") {
        return Err("Error: 'gh' CLI not found. Install it from https://cli.github.com".to_string());
    }
    let (action, name) = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let worktrees = get_worktrees(&root)?;
    if worktrees.is_empty() {
        return Err("No worktrees found".to_string());
    }
    let worktree = if let Some(name) = name.as_deref() {
        resolve_worktree(&worktrees, name)?.clone()
    } else {
        select_worktree(&worktrees)?
    };
    let branch = worktree
        .branch
        .ok_or_else(|| "Error: Worktree is in detached HEAD state".to_string())?;

    if action.as_deref() == Some("create") {
        println!("Creating PR for '{}'...", branch);
        let result = run_command("gh", &["pr", "create", "--web", "--head", &branch], None)?;
        if result.exit_code != 0 {
            return Err(format!("Error: Failed to create PR\n{}", result.stderr.trim()));
        }
    } else {
        let result = run_command("gh", &["pr", "view", &branch, "--web"], None)?;
        if result.exit_code != 0 {
            let stderr = result.stderr.trim();
            if stderr.contains("no pull requests found") {
                return Err(format!("No PR found for branch '{}'. Use 'gwt pr create' to create one.", branch));
            }
            return Err(format!("Error: Failed to view PR\n{}", stderr));
        }
    }

    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<(Option<String>, Option<String>)> {
    let mut action = None;
    let mut name = None;
    let mut index = 0;

    while index < args.len() {
        match arg_to_str(&args[index])? {
            "-w" => {
                index += 1;
                let value = args.get(index).ok_or_else(|| "Error: -w requires a worktree name".to_string())?;
                name = Some(arg_to_str(value)?.to_string());
            }
            value if value.starts_with('-') => return Err(format!("Error: unknown pr option '{value}'")),
            value => {
                if action.is_none() && value == "create" {
                    action = Some(value.to_string());
                } else if name.is_none() {
                    name = Some(value.to_string());
                } else {
                    return Err("Error: too many pr arguments".to_string());
                }
            }
        }
        index += 1;
    }

    Ok((action, name))
}
