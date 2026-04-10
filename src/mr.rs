use std::ffi::OsString;

use crate::AppResult;
use crate::arg_to_str;
use crate::cd::{resolve_worktree, select_worktree};
use crate::repo::{command_exists, ensure_gwt_setup, get_worktrees, run_command};

pub fn run(args: &[OsString]) -> AppResult<()> {
    if !command_exists("glab") {
        return Err("Error: 'glab' CLI not found. Install it from https://gitlab.com/gitlab-org/cli".to_string());
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
        println!("Creating MR for '{}'...", branch);
        let result = run_command("glab", &["mr", "create", "--web", "--source-branch", &branch], None)?;
        if result.exit_code != 0 {
            return Err(format!("Error: Failed to create MR\n{}", result.stderr.trim()));
        }
    } else {
        let result = run_command("glab", &["mr", "view", &branch, "--web"], None)?;
        if result.exit_code != 0 {
            let stderr = result.stderr.trim();
            if stderr.contains("no merge request found") || stderr.contains("no open merge request") {
                return Err(format!("No MR found for branch '{}'. Use 'gwt mr create' to create one.", branch));
            }
            return Err(format!("Error: Failed to view MR\n{}", stderr));
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
            value if value.starts_with('-') => return Err(format!("Error: unknown mr option '{value}'")),
            value => {
                if action.is_none() && value == "create" {
                    action = Some(value.to_string());
                } else if name.is_none() {
                    name = Some(value.to_string());
                } else {
                    return Err("Error: too many mr arguments".to_string());
                }
            }
        }
        index += 1;
    }

    Ok((action, name))
}
