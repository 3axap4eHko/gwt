use std::ffi::OsString;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{ensure_gwt_setup, git, path_arg};
use crate::validation::is_valid_worktree_name;

pub fn run_lock(args: &[OsString]) -> AppResult<()> {
    let (name, reason) = parse_lock_args(args)?;
    let root = ensure_gwt_setup()?;
    let path = root.join(&name);
    let mut command = vec![
        OsString::from("worktree"),
        OsString::from("lock"),
        path_arg(&path)?,
    ];
    if let Some(reason) = &reason {
        command.push(OsString::from("--reason"));
        command.push(OsString::from(reason));
    }
    let result = git(command, Some(&root))?;
    if result.exit_code != 0 {
        return Err(format!(
            "Error: Failed to lock worktree\n{}",
            result.stderr.trim()
        ));
    }
    println!(
        "Locked '{}'{}",
        name,
        reason
            .map(|value| format!(": {}", value))
            .unwrap_or_default()
    );
    Ok(())
}

pub fn run_unlock(args: &[OsString]) -> AppResult<()> {
    let name = single_name(args, "unlock")?;
    let root = ensure_gwt_setup()?;
    let result = git(
        [
            OsString::from("worktree"),
            OsString::from("unlock"),
            path_arg(&root.join(&name))?,
        ],
        Some(&root),
    )?;
    if result.exit_code != 0 {
        return Err(format!(
            "Error: Failed to unlock worktree\n{}",
            result.stderr.trim()
        ));
    }
    println!("Unlocked '{}'", name);
    Ok(())
}

pub fn run_move(args: &[OsString]) -> AppResult<()> {
    let (name, new_name) = parse_move_args(args)?;
    let root = ensure_gwt_setup()?;
    let dest = root.join(&new_name);
    let result = git(
        [
            OsString::from("worktree"),
            OsString::from("move"),
            path_arg(&root.join(&name))?,
            path_arg(&dest)?,
        ],
        Some(&root),
    )?;
    if result.exit_code != 0 {
        return Err(format!(
            "Error: Failed to move worktree\n{}",
            result.stderr.trim()
        ));
    }
    println!("Moved '{}' to '{}'", name, new_name);
    Ok(())
}

fn parse_move_args(args: &[OsString]) -> AppResult<(String, String)> {
    if args.len() != 2 {
        return Err("Error: move requires <name> <new-name>".to_string());
    }
    let name = arg_to_str(&args[0])?.to_string();
    let new_name = arg_to_str(&args[1])?.to_string();
    if !is_valid_worktree_name(&name) {
        return Err("Error: Invalid worktree name".to_string());
    }
    if !is_valid_worktree_name(&new_name) {
        return Err("Error: Invalid destination worktree name".to_string());
    }
    Ok((name, new_name))
}

fn parse_lock_args(args: &[OsString]) -> AppResult<(String, Option<String>)> {
    let mut name = None;
    let mut reason = None;
    let mut index = 0;
    while index < args.len() {
        match arg_to_str(&args[index])? {
            "-r" | "--reason" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "Error: --reason requires a value".to_string())?;
                reason = Some(arg_to_str(value)?.to_string());
            }
            value if value.starts_with('-') => {
                return Err(format!("Error: unknown lock option '{value}'"));
            }
            value => {
                if name.is_some() {
                    return Err("Error: lock accepts exactly one worktree name".to_string());
                }
                name = Some(value.to_string());
            }
        }
        index += 1;
    }

    let name = name.ok_or_else(|| "Error: lock requires a worktree name".to_string())?;
    if !is_valid_worktree_name(&name) {
        return Err("Error: Invalid worktree name".to_string());
    }
    Ok((name, reason))
}

fn single_name(args: &[OsString], command: &str) -> AppResult<String> {
    if args.len() != 1 {
        return Err(format!("Error: {} requires a worktree name", command));
    }
    let name = arg_to_str(&args[0])?.to_string();
    if !is_valid_worktree_name(&name) {
        return Err("Error: Invalid worktree name".to_string());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::parse_move_args;

    #[test]
    fn parses_flat_move_destination() {
        let result = parse_move_args(&[OsString::from("feature"), OsString::from("renamed")]);

        assert_eq!(result, Ok(("feature".to_string(), "renamed".to_string())));
    }

    #[test]
    fn rejects_nested_move_destination() {
        let result =
            parse_move_args(&[OsString::from("feature"), OsString::from("nested/renamed")]);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_parent_move_destination() {
        let result = parse_move_args(&[OsString::from("feature"), OsString::from("../renamed")]);

        assert!(result.is_err());
    }
}
