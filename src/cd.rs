use std::ffi::OsString;

use dialoguer::Select;
use dialoguer::console::Term;
use dialoguer::theme::ColorfulTheme;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{Worktree, ensure_gwt_setup, format_age, get_worktrees};

pub fn run(args: &[OsString]) -> AppResult<()> {
    let root = ensure_gwt_setup()?;
    let worktrees = get_worktrees(&root)?;
    if worktrees.is_empty() {
        return Err("No worktrees found".to_string());
    }

    let selected = if let Some(name) = args.first() {
        resolve_worktree(&worktrees, arg_to_str(name)?)?.clone()
    } else {
        select_worktree(&worktrees)?
    };

    println!("{}", selected.path.display());
    Ok(())
}

pub fn resolve_worktree<'a>(worktrees: &'a [Worktree], name: &str) -> AppResult<&'a Worktree> {
    worktrees
        .iter()
        .find(|worktree| worktree.name == name)
        .ok_or_else(|| {
            let available = worktrees
                .iter()
                .map(|worktree| worktree.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            format!("Worktree '{name}' not found\nAvailable: {available}")
        })
}

pub fn select_worktree(worktrees: &[Worktree]) -> AppResult<Worktree> {
    let max_name = worktrees
        .iter()
        .map(|worktree| worktree.name.len())
        .max()
        .unwrap_or(0);
    let labels = worktrees
        .iter()
        .map(|worktree| format_worktree_label(worktree, max_name))
        .collect::<Vec<_>>();
    let selection = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Select worktree")
        .items(&labels)
        .default(0)
        .report(false)
        .interact_on_opt(&Term::stderr())
        .map_err(|error| error.to_string())?;

    let Some(index) = selection else {
        std::process::exit(1);
    };

    match worktrees.get(index) {
        Some(worktree) => Ok(worktree.clone()),
        None => Err("Error: invalid selection".to_string()),
    }
}

fn format_worktree_label(worktree: &Worktree, max_name: usize) -> String {
    let branch = worktree.branch.as_deref().unwrap_or("(detached)");
    let age = format_age(worktree.mtime);
    format!(
        "{}  {}  {}",
        pad_name(&worktree.name, max_name),
        branch,
        age
    )
}

fn pad_name(name: &str, width: usize) -> String {
    let mut padded = String::with_capacity(width);
    padded.push_str(name);
    if width > name.len() {
        padded.push_str(&" ".repeat(width - name.len()));
    }
    padded
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{format_worktree_label, pad_name, resolve_worktree};
    use crate::repo::Worktree;

    #[test]
    fn formats_worktree_label() {
        let label = format_worktree_label(
            &Worktree {
                path: PathBuf::from("/repo/feature"),
                name: "feature".to_string(),
                branch: Some("feature".to_string()),
                mtime: 0,
            },
            7,
        );

        assert_eq!(label, "feature  feature  ");
    }

    #[test]
    fn formats_detached_worktree_label() {
        let label = format_worktree_label(
            &Worktree {
                path: PathBuf::from("/repo/detached"),
                name: "detached".to_string(),
                branch: None,
                mtime: 0,
            },
            10,
        );

        assert_eq!(label, "detached    (detached)  ");
    }

    #[test]
    fn pads_name_to_width() {
        assert_eq!(pad_name("feat", 7), "feat   ");
    }

    #[test]
    fn resolves_worktree_by_name() {
        let worktree = Worktree {
            path: PathBuf::from("/repo/feature"),
            name: "feature".to_string(),
            branch: Some("feature".to_string()),
            mtime: 0,
        };
        let other = Worktree {
            path: PathBuf::from("/repo/master"),
            name: "master".to_string(),
            branch: Some("master".to_string()),
            mtime: 0,
        };
        let worktrees = vec![worktree.clone(), other];

        assert_eq!(resolve_worktree(&worktrees, "feature"), Ok(&worktree));
    }
}
