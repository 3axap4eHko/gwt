use std::ffi::OsString;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{ensure_gwt_setup, get_default_branch, git, path_arg};
use crate::validation::is_valid_worktree_name;

struct AddOptions {
    name: String,
    from: Option<String>,
    no_fetch: bool,
    cache: bool,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let worktree_path = root.join(&options.name);
    if worktree_path.exists() {
        return Err(format!(
            "Error: Directory '{}' already exists",
            options.name
        ));
    }

    if !options.no_fetch {
        eprintln!("Fetching remotes...");
        let fetch = git(["fetch", "--all"], Some(&root))?;
        if fetch.exit_code != 0 {
            eprintln!("Warning: Failed to fetch remotes");
        }
    }

    let from_branch = options
        .from
        .clone()
        .or_else(|| get_default_branch(&root))
        .unwrap_or_else(|| "master".to_string());

    let remote_ref = find_remote_branch(&root, &options.name)?;
    let local_branch_exists = branch_exists_locally(&root, &options.name)?;

    let command = if local_branch_exists {
        eprintln!(
            "Creating worktree '{}' from existing branch...",
            options.name
        );
        vec![
            OsString::from("worktree"),
            OsString::from("add"),
            path_arg(&worktree_path)?,
            OsString::from(&options.name),
        ]
    } else if let Some(remote_ref) = &remote_ref {
        eprintln!(
            "Creating worktree '{}' tracking remote branch...",
            options.name
        );
        vec![
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("--track"),
            OsString::from("-b"),
            OsString::from(&options.name),
            path_arg(&worktree_path)?,
            OsString::from(remote_ref),
        ]
    } else {
        let start_point = resolve_start_point(&root, &from_branch)?;
        eprintln!(
            "Creating worktree '{}' as new branch from '{}'...",
            options.name, from_branch
        );
        vec![
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("--no-track"),
            OsString::from("-b"),
            OsString::from(&options.name),
            path_arg(&worktree_path)?,
            OsString::from(start_point),
        ]
    };

    let result = git(command, Some(&root))?;
    if result.exit_code != 0 {
        return Err(format!(
            "Error: Failed to create worktree\n{}",
            result.stderr.trim()
        ));
    }

    if local_branch_exists {
        if let Some(remote_ref) = remote_ref {
            let has_upstream = git(
                [
                    OsString::from("config"),
                    OsString::from(format!("branch.{}.remote", options.name)),
                ],
                Some(&root),
            )?;
            if has_upstream.exit_code != 0 {
                let _ = git(
                    [
                        OsString::from("branch"),
                        OsString::from(format!("--set-upstream-to={remote_ref}")),
                        OsString::from(&options.name),
                    ],
                    Some(&root),
                )?;
            }
        }
    }

    eprintln!("Done! Worktree created at {}/", options.name);

    if options.cache {
        crate::cache::apply_all(&root, &worktree_path)?;
    }

    println!("{}", worktree_path.display());
    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<AddOptions> {
    let mut name = None;
    let mut from = None;
    let mut no_fetch = false;
    let mut cache = false;
    let mut index = 0;

    while index < args.len() {
        match arg_to_str(&args[index])? {
            "-f" | "--from" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "Error: --from requires a branch".to_string())?;
                from = Some(arg_to_str(value)?.to_string());
            }
            "-n" | "--no-fetch" => no_fetch = true,
            "--cache" => cache = true,
            value if value.starts_with('-') => {
                return Err(format!("Error: unknown add option '{value}'"));
            }
            value => {
                if name.is_some() {
                    return Err("Error: add accepts exactly one worktree name".to_string());
                }
                name = Some(value.to_string());
            }
        }
        index += 1;
    }

    let name = name.ok_or_else(|| "Error: add requires a worktree name".to_string())?;
    if !is_valid_worktree_name(&name) {
        return Err("Error: Invalid worktree name".to_string());
    }

    Ok(AddOptions {
        name,
        from,
        no_fetch,
        cache,
    })
}

fn find_remote_branch(root: &std::path::Path, name: &str) -> AppResult<Option<String>> {
    let refs = git(
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
        Some(root),
    )?;
    if refs.exit_code != 0 {
        return Ok(None);
    }

    let mut valid = Vec::new();
    for reference in refs.stdout.lines() {
        if reference.ends_with("/HEAD") || !reference.ends_with(&format!("/{name}")) {
            continue;
        }

        let remote = &reference[..reference.len().saturating_sub(name.len() + 1)];
        if remote.is_empty() {
            continue;
        }

        let remote_exists = git(
            [
                OsString::from("remote"),
                OsString::from("get-url"),
                OsString::from(remote),
            ],
            Some(root),
        )?;
        if remote_exists.exit_code == 0 {
            valid.push(reference.to_string());
        }
    }

    if let Some(origin) = valid
        .iter()
        .find(|reference| *reference == &format!("origin/{name}"))
    {
        Ok(Some(origin.clone()))
    } else {
        Ok(valid.into_iter().next())
    }
}

fn branch_exists_locally(root: &std::path::Path, name: &str) -> AppResult<bool> {
    let result = git(
        [
            OsString::from("show-ref"),
            OsString::from("--verify"),
            OsString::from(format!("refs/heads/{name}")),
        ],
        Some(root),
    )?;
    Ok(result.exit_code == 0)
}

fn resolve_start_point(root: &std::path::Path, branch: &str) -> AppResult<String> {
    Ok(find_remote_branch(root, branch)?.unwrap_or_else(|| branch.to_string()))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::parse_options;

    #[test]
    fn parses_cache_before_name() {
        let options = parse_options(&[OsString::from("--cache"), OsString::from("feature")])
            .expect("options should parse");

        assert_eq!(options.name, "feature");
        assert!(options.cache);
    }

    #[test]
    fn parses_cache_after_name() {
        let options = parse_options(&[OsString::from("feature"), OsString::from("--cache")])
            .expect("options should parse");

        assert_eq!(options.name, "feature");
        assert!(options.cache);
    }
}
