use std::ffi::OsString;
use std::io::{self, Write};

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
    let max_name = worktrees.iter().map(|worktree| worktree.name.len()).max().unwrap_or(0);
    let mut stderr = io::stderr().lock();

    writeln!(stderr, "Select worktree").map_err(|error| error.to_string())?;
    for (index, worktree) in worktrees.iter().enumerate() {
        let branch = worktree.branch.as_deref().unwrap_or("(detached)");
        let age = format_age(worktree.mtime);
        writeln!(
            stderr,
            "{}. {}  {}  {}",
            index + 1,
            pad_name(&worktree.name, max_name),
            branch,
            age
        )
        .map_err(|error| error.to_string())?;
    }
    write!(stderr, "> ").map_err(|error| error.to_string())?;
    stderr.flush().map_err(|error| error.to_string())?;
    drop(stderr);

    let mut input = String::new();
    io::stdin().read_line(&mut input).map_err(|error| error.to_string())?;
    let trimmed = input.trim();
    if trimmed.is_empty() {
        std::process::exit(1);
    }

    let index = trimmed
        .parse::<usize>()
        .map_err(|_| "Error: invalid selection".to_string())?;
    match worktrees.get(index.saturating_sub(1)) {
        Some(worktree) => Ok(worktree.clone()),
        None => Err("Error: invalid selection".to_string()),
    }
}

fn pad_name(name: &str, width: usize) -> String {
    let mut padded = String::with_capacity(width);
    padded.push_str(name);
    if width > name.len() {
        padded.push_str(&" ".repeat(width - name.len()));
    }
    padded
}
