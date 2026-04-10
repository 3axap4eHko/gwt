use std::ffi::OsString;
use std::process::{Command, Stdio};

use crate::AppResult;
use crate::arg_to_str;
use crate::cd::{resolve_worktree, select_worktree};
use crate::repo::{ensure_gwt_setup, get_worktrees};

pub fn run(args: &[OsString]) -> AppResult<()> {
    let (worktree_name, command) = parse_options(args)?;
    if command.is_empty() {
        return Err("Error: run requires a command".to_string());
    }

    let root = ensure_gwt_setup()?;
    let worktrees = get_worktrees(&root)?;
    if worktrees.is_empty() {
        return Err("No worktrees found".to_string());
    }

    let worktree = if let Some(name) = worktree_name.as_deref() {
        resolve_worktree(&worktrees, name)?.clone()
    } else {
        select_worktree(&worktrees)?
    };

    let mut cmd = Command::new(&command[0]);
    if command.len() > 1 {
        cmd.args(&command[1..]);
    }
    let status = cmd
        .current_dir(&worktree.path)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| error.to_string())?;

    if let Some(code) = status.code() {
        if code != 0 {
            std::process::exit(code);
        }
    } else {
        std::process::exit(1);
    }

    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<(Option<String>, Vec<OsString>)> {
    let mut worktree = None;
    let mut index = 0;

    while index < args.len() {
        match arg_to_str(&args[index])? {
            "-w" | "--worktree" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "Error: -w requires a worktree name".to_string())?;
                worktree = Some(arg_to_str(value)?.to_string());
                index += 1;
            }
            "--" => return Ok((worktree, args[index + 1..].to_vec())),
            _ => return Ok((worktree, args[index..].to_vec())),
        }
    }

    Ok((worktree, Vec::new()))
}
