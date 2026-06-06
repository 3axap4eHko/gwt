use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

use crate::AppResult;
use crate::arg_to_str;
use crate::cd::{resolve_worktree, select_worktree};
use crate::repo::{command_exists, ensure_gwt_setup, get_worktrees, git_string};

struct EditOptions {
    name: Option<String>,
    add: bool,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let worktrees = get_worktrees(&root)?;
    if worktrees.is_empty() {
        return Err("No worktrees found".to_string());
    }

    let worktree = if let Some(name) = options.name.as_deref() {
        resolve_worktree(&worktrees, name)?.clone()
    } else {
        select_worktree(&worktrees)?
    };

    open_in_editor(&root, &worktree.path, options.add)?;
    println!("{}", worktree.path.display());
    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<EditOptions> {
    let mut name = None;
    let mut add = false;

    for arg in args {
        match arg_to_str(arg)? {
            "-a" | "--add" => add = true,
            value if value.starts_with('-') => {
                return Err(format!("Error: unknown edit option '{value}'"));
            }
            value => {
                if name.is_some() {
                    return Err("Error: edit accepts at most one worktree name".to_string());
                }
                name = Some(value.to_string());
            }
        }
    }

    Ok(EditOptions { name, add })
}

fn open_in_editor(
    root: &std::path::Path,
    path: &std::path::Path,
    add_to_workspace: bool,
) -> AppResult<()> {
    let ide = detect_ide(root)?.ok_or_else(|| {
        "No IDE found. Set one with: git config --global gwt.ide <ide>".to_string()
    })?;
    let use_add = add_to_workspace && matches!(ide.as_str(), "code" | "cursor");
    let mut command = Command::new(&ide);
    if use_add {
        command.arg("--add");
    }
    command.arg(path);
    if should_detach_editor(&ide) {
        command.spawn().map_err(|error| error.to_string())?;
    } else {
        let status = command.status().map_err(|error| error.to_string())?;
        if !status.success() {
            eprintln!("Warning: Failed to open {}", ide);
        }
    }
    Ok(())
}

fn should_detach_editor(ide: &str) -> bool {
    let Some(name) = Path::new(ide).file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(name, "code" | "cursor" | "zed" | "code-insiders")
}

fn detect_ide(root: &std::path::Path) -> AppResult<Option<String>> {
    let configured = git_string(root, ["config", "gwt.ide"])?;
    if let Some(ide) = configured
        && !ide.is_empty()
    {
        return Ok(Some(ide));
    }

    if let Ok(visual) = std::env::var("VISUAL")
        && !visual.is_empty()
    {
        return Ok(Some(visual));
    }

    for ide in ["zed", "nvim", "cursor", "code"] {
        if command_exists(ide) {
            return Ok(Some(ide.to_string()));
        }
    }

    if let Ok(editor) = std::env::var("EDITOR")
        && !editor.is_empty()
    {
        return Ok(Some(editor));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::should_detach_editor;

    #[test]
    fn detaches_known_gui_editors() {
        assert!(should_detach_editor("code"));
        assert!(should_detach_editor("cursor"));
        assert!(should_detach_editor("zed"));
        assert!(should_detach_editor("/usr/bin/code-insiders"));
    }

    #[test]
    fn keeps_terminal_editors_attached() {
        assert!(!should_detach_editor("nvim"));
        assert!(!should_detach_editor("vim"));
        assert!(!should_detach_editor("hx"));
    }
}
