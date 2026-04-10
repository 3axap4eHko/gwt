use std::ffi::OsString;
use std::path::PathBuf;
use std::thread;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{ensure_gwt_setup, get_default_branch, git, git_in_worktree, path_arg};
use crate::validation::is_valid_worktree_name;

struct RmOptions {
    names: Vec<String>,
    force: bool,
}

struct RemovalCandidate {
    name: String,
    path: PathBuf,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;

    if !options.force {
        let _ = git(["fetch", "--all"], Some(&root))?;
    }

    let mut failures = 0;

    if options.force {
        for name in options.names {
            if let Err(message) = remove_one(&root, name, true) {
                failures += 1;
                eprintln!("{message}");
            }
        }
    } else {
        let checks = thread::scope(|scope| {
            let mut tasks = Vec::new();
            for name in options.names {
                let root = root.clone();
                tasks.push(scope.spawn(move || prepare_removal(&root, name)));
            }

            let mut results = Vec::new();
            for task in tasks {
                let result = task.join().map_err(|_| "Error: worker thread panicked".to_string())?;
                results.push(result);
            }
            Ok::<Vec<AppResult<RemovalCandidate>>, String>(results)
        })?;

        for candidate in checks {
            match candidate {
                Ok(candidate) => {
                    if let Err(message) = remove_candidate(&root, candidate, false) {
                        failures += 1;
                        eprintln!("{message}");
                    }
                }
                Err(message) => {
                    failures += 1;
                    eprintln!("{message}");
                }
            }
        }
    }

    if failures > 0 {
        Err(format!(
            "Failed to remove {failures} worktree{}",
            if failures > 1 { "s" } else { "" }
        ))
    } else {
        Ok(())
    }
}

fn parse_options(args: &[OsString]) -> AppResult<RmOptions> {
    let mut names = Vec::new();
    let mut force = false;

    for arg in args {
        match arg_to_str(arg)? {
            "-f" | "--force" => force = true,
            value if value.starts_with('-') => return Err(format!("Error: unknown rm option '{value}'")),
            value => names.push(value.to_string()),
        }
    }

    if names.is_empty() {
        return Err("Error: No worktree names provided".to_string());
    }

    for name in &names {
        if !is_valid_worktree_name(name) {
            return Err(format!("Error: Invalid worktree name '{name}'"));
        }
    }

    Ok(RmOptions { names, force })
}

fn prepare_removal(root: &std::path::Path, name: String) -> AppResult<RemovalCandidate> {
    let path = root.join(&name);
    if !path.exists() {
        return Err(format!("Error: Worktree '{name}' not found"));
    }

    let issues = check_safety(root, &name, &path)?;
    if !issues.is_empty() {
        let message = format!(
            "Cannot remove '{name}' due to safety checks:\n\n{}\n\nUse --force to override (at your own risk)",
            issues
                .iter()
                .map(|issue| format!("  - {issue}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        return Err(message);
    }

    Ok(RemovalCandidate { name, path })
}

fn remove_one(root: &std::path::Path, name: String, force: bool) -> AppResult<()> {
    let path = root.join(&name);
    if !path.exists() {
        return Err(format!("Error: Worktree '{name}' not found"));
    }
    remove_candidate(root, RemovalCandidate { name, path }, force)
}

fn remove_candidate(root: &std::path::Path, candidate: RemovalCandidate, force: bool) -> AppResult<()> {
    println!("Removing worktree '{}'...", candidate.name);
    let remove = git(
        [
            std::ffi::OsString::from("worktree"),
            std::ffi::OsString::from("remove"),
            path_arg(&candidate.path)?,
        ],
        Some(root),
    )?;

    if remove.exit_code != 0 {
        if force {
            let forced = git(
                [
                    std::ffi::OsString::from("worktree"),
                    std::ffi::OsString::from("remove"),
                    std::ffi::OsString::from("--force"),
                    path_arg(&candidate.path)?,
                ],
                Some(root),
            )?;
            if forced.exit_code != 0 {
                return Err(format!(
                    "Error: Failed to remove worktree '{}'\n{}",
                    candidate.name,
                    forced.stderr.trim()
                ));
            }
        } else {
            return Err(format!(
                "Error: Failed to remove worktree '{}'\n{}\n\nUse --force to override",
                candidate.name,
                remove.stderr.trim()
            ));
        }
    }

    let branch_deleted = try_delete_branch(root, &candidate.name)?;
    println!("Done! Worktree '{}' removed", candidate.name);
    if branch_deleted {
        println!("  Branch '{}' also deleted", candidate.name);
    }
    Ok(())
}

fn check_safety(root: &std::path::Path, name: &str, path: &std::path::Path) -> AppResult<Vec<String>> {
    let mut issues = Vec::new();

    if let Some(default_branch) = get_default_branch(root) {
        if name == default_branch {
            issues.push(format!("'{name}' is the default branch"));
        }
    }

    let status = git_in_worktree(path, &["status", "--porcelain"])?;
    if status.exit_code != 0 {
        issues.push("Failed to check worktree status".to_string());
    } else if !status.stdout.trim().is_empty() {
        issues.push("Uncommitted changes in worktree".to_string());
    }

    let tracking_ref = find_tracking_ref(root, name)?;
    if let Some(tracking_ref) = tracking_ref {
        let ahead_ref = format!("{tracking_ref}..HEAD");
        let behind_ref = format!("HEAD..{tracking_ref}");
        let ahead = git_in_worktree(path, &["rev-list", "--count", ahead_ref.as_str()])?;
        let behind = git_in_worktree(path, &["rev-list", "--count", behind_ref.as_str()])?;

        if ahead.exit_code != 0 {
            issues.push("Failed to check unpushed commits".to_string());
        } else if let Ok(count) = ahead.stdout.trim().parse::<u64>() {
            if count > 0 {
                issues.push(format!(
                    "{count} unpushed commit{}",
                    if count > 1 { "s" } else { "" }
                ));
            }
        }

        if behind.exit_code != 0 {
            issues.push("Failed to check commits behind remote".to_string());
        } else if let Ok(count) = behind.stdout.trim().parse::<u64>() {
            if count > 0 {
                issues.push(format!(
                    "{count} commit{} behind remote",
                    if count > 1 { "s" } else { "" }
                ));
            }
        }
    } else {
        issues.push(format!("Branch '{name}' not pushed to remote"));
    }

    Ok(issues)
}

fn find_tracking_ref(root: &std::path::Path, name: &str) -> AppResult<Option<String>> {
    let local_ref = format!("refs/heads/{name}");
    let upstream = git(
        [
            OsString::from("for-each-ref"),
            OsString::from("--format=%(upstream:short)"),
            OsString::from(local_ref),
        ],
        Some(root),
    )?;
    if upstream.exit_code == 0 {
        let tracking_ref = upstream.stdout.trim().to_string();
        if !tracking_ref.is_empty() {
            return Ok(Some(tracking_ref));
        }
    }

    let scan = git(
        [
            OsString::from("for-each-ref"),
            OsString::from("--format=%(refname:short)"),
            OsString::from("refs/remotes"),
        ],
        Some(root),
    )?;
    if scan.exit_code != 0 {
        return Ok(None);
    }

    let mut refs = Vec::new();
    for reference in scan.stdout.lines() {
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
            refs.push(reference.to_string());
        }
    }

    if refs.is_empty() {
        Ok(None)
    } else if let Some(origin) = refs.iter().find(|reference| *reference == &format!("origin/{name}")) {
        Ok(Some(origin.clone()))
    } else {
        Ok(refs.into_iter().next())
    }
}

fn try_delete_branch(root: &std::path::Path, name: &str) -> AppResult<bool> {
    if let Some(default_branch) = get_default_branch(root) {
        if name == default_branch {
            return Ok(false);
        }
    }

    let output = git(
        [
            OsString::from("branch"),
            OsString::from("-d"),
            OsString::from(name),
        ],
        Some(root),
    )?;
    Ok(output.exit_code == 0)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::parse_options;

    #[test]
    fn parses_rm_options() {
        let options = parse_options(&[
            OsString::from("a"),
            OsString::from("b"),
            OsString::from("--force"),
        ])
        .expect("rm options should parse");
        assert!(options.force);
        assert_eq!(options.names, vec!["a", "b"]);
    }
}
