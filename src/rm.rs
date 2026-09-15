use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;
use std::thread;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{Worktree, ensure_gwt_setup, get_default_branch, get_worktrees, git};
use crate::repo::{git_in_worktree, path_arg};
use crate::validation::is_valid_worktree_name;

struct RmOptions {
    names: Vec<String>,
    force: bool,
    no_fetch: bool,
}

struct RemovalCandidate {
    name: String,
    path: PathBuf,
    branch: Option<String>,
    commit: Option<String>,
}

struct SafetyContext {
    default_branch: Option<String>,
    default_commit: String,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let default_branch = get_default_branch(&root);

    let mut failures = 0;

    if options.force {
        let worktrees = get_worktrees(&root)?;
        for name in options.names {
            match resolve_candidate(&worktrees, name) {
                Ok(candidate) => {
                    if let Err(message) =
                        remove_candidate(&root, candidate, true, default_branch.as_deref())
                    {
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
    } else {
        let candidates = resolve_candidates(&root, options.names)?;
        let default_commit =
            load_default_commit(&root, default_branch.as_deref(), options.no_fetch)?;
        let context = SafetyContext {
            default_branch,
            default_commit,
        };
        let checks = thread::scope(|scope| {
            let mut tasks = Vec::new();
            for candidate in candidates {
                let context = &context;
                tasks.push(scope.spawn(move || prepare_removal(context, candidate)));
            }

            let mut results = Vec::new();
            for task in tasks {
                let result = task
                    .join()
                    .map_err(|_| "Error: worker thread panicked".to_string())?;
                results.push(result);
            }
            Ok::<Vec<AppResult<RemovalCandidate>>, String>(results)
        })?;

        for candidate in checks {
            match candidate {
                Ok(candidate) => {
                    if let Err(message) =
                        remove_candidate(&root, candidate, false, context.default_branch.as_deref())
                    {
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
    let mut no_fetch = false;

    for arg in args {
        match arg_to_str(arg)? {
            "-f" | "--force" => force = true,
            "-n" | "--no-fetch" => no_fetch = true,
            value if value.starts_with('-') => {
                return Err(format!("Error: unknown rm option '{value}'"));
            }
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

    Ok(RmOptions {
        names,
        force,
        no_fetch,
    })
}

fn resolve_candidates(root: &Path, names: Vec<String>) -> AppResult<Vec<RemovalCandidate>> {
    let worktrees = get_worktrees(root)?;
    let mut candidates = Vec::with_capacity(names.len());
    for name in names {
        candidates.push(resolve_candidate(&worktrees, name)?);
    }
    Ok(candidates)
}

fn resolve_candidate(worktrees: &[Worktree], name: String) -> AppResult<RemovalCandidate> {
    let candidate = select_candidate(worktrees, name)?;
    if !candidate.path.exists() {
        return Err(format!("Error: Worktree '{}' not found", candidate.name));
    }
    Ok(candidate)
}

fn select_candidate(worktrees: &[Worktree], name: String) -> AppResult<RemovalCandidate> {
    let worktree = worktrees
        .iter()
        .find(|worktree| worktree.name == name)
        .ok_or_else(|| format!("Error: Worktree '{name}' not found"))?;
    Ok(RemovalCandidate {
        name,
        path: worktree.path.clone(),
        branch: worktree.branch.clone(),
        commit: None,
    })
}

fn prepare_removal(
    context: &SafetyContext,
    mut candidate: RemovalCandidate,
) -> AppResult<RemovalCandidate> {
    if !candidate.path.exists() {
        return Err(format!("Error: Worktree '{}' not found", candidate.name));
    }

    if let Some(branch) = &candidate.branch {
        let revision = format!("refs/heads/{branch}^{{commit}}");
        let commit = git_in_worktree(&candidate.path, &["rev-parse", "--verify", &revision])?;
        if commit.exit_code != 0 {
            return Err(format!(
                "Error: Failed to resolve branch '{branch}'\n{}",
                commit.stderr.trim()
            ));
        }
        candidate.commit = Some(commit.stdout.trim().to_string());
    }
    let issues = check_safety(context, &candidate)?;
    if !issues.is_empty() {
        let message = format!(
            "Cannot remove '{}' due to safety checks:\n\n{}\n\nUse --force to override (at your own risk)",
            candidate.name,
            issues
                .iter()
                .map(|issue| format!("  - {issue}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        return Err(message);
    }

    Ok(candidate)
}

fn remove_candidate(
    root: &std::path::Path,
    candidate: RemovalCandidate,
    force: bool,
    default_branch: Option<&str>,
) -> AppResult<()> {
    if !force && candidate.branch.is_some() && candidate.commit.is_none() {
        return Err(format!(
            "Error: No validated commit for worktree '{}'",
            candidate.name
        ));
    }
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

    let branch_deleted = try_delete_branch(
        root,
        candidate.branch.as_deref(),
        default_branch,
        if force {
            None
        } else {
            candidate.commit.as_deref()
        },
    )
    .map_err(|error| {
        format!(
            "Worktree '{}' removed, but branch cleanup failed:\n{error}",
            candidate.name
        )
    })?;
    println!("Done! Worktree '{}' removed", candidate.name);
    if let Some(branch) = branch_deleted {
        println!("  Branch '{}' also deleted", branch);
    }
    Ok(())
}

fn check_safety(context: &SafetyContext, candidate: &RemovalCandidate) -> AppResult<Vec<String>> {
    let mut issues = Vec::new();

    if let (Some(default_branch), Some(branch)) = (&context.default_branch, &candidate.branch)
        && branch == default_branch
    {
        issues.push(format!("'{branch}' is the default branch"));
    }

    let status = git_in_worktree(&candidate.path, &["status", "--porcelain"])?;
    if status.exit_code != 0 {
        issues.push("Failed to check worktree status".to_string());
    } else if !status.stdout.trim().is_empty() {
        issues.push("Uncommitted changes in worktree".to_string());
    }

    let Some(branch) = candidate.branch.as_deref() else {
        issues.push("Worktree is in detached HEAD state".to_string());
        return Ok(issues);
    };

    let commit = candidate
        .commit
        .as_deref()
        .ok_or_else(|| format!("Error: No captured commit for branch '{branch}'"))?;
    let ancestry = git_in_worktree(
        &candidate.path,
        &[
            "merge-base",
            "--is-ancestor",
            commit,
            &context.default_commit,
        ],
    )?;
    match ancestry.exit_code {
        0 => {}
        1 => issues.push(format!(
            "Branch '{branch}' is not merged into the remote default branch"
        )),
        _ => issues.push(format!(
            "Failed to check ancestry against the remote default branch: {}",
            ancestry.stderr.trim()
        )),
    }

    Ok(issues)
}

fn load_default_commit(
    root: &Path,
    default_branch: Option<&str>,
    no_fetch: bool,
) -> AppResult<String> {
    let branch =
        default_branch.ok_or_else(|| "Error: Default branch is not configured".to_string())?;
    let reference = format!("refs/remotes/origin/{branch}");
    if !no_fetch {
        let refspec = format!("+refs/heads/{branch}:{reference}");
        let fetch = git(["fetch", "--no-tags", "origin", &refspec], Some(root))?;
        if fetch.exit_code != 0 {
            return Err(format!(
                "Error: Failed to fetch default branch '{branch}'\n{}",
                fetch.stderr.trim()
            ));
        }
    }

    let revision = format!("{reference}^{{commit}}");
    let commit = git(["rev-parse", "--verify", &revision], Some(root))?;
    if commit.exit_code != 0 {
        return Err(format!(
            "Error: Failed to resolve remote default branch '{branch}'\n{}",
            commit.stderr.trim()
        ));
    }
    Ok(commit.stdout.trim().to_string())
}

fn try_delete_branch(
    root: &std::path::Path,
    branch: Option<&str>,
    default_branch: Option<&str>,
    expected_commit: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(name) = branch else {
        return Ok(None);
    };
    if let Some(default_branch) = default_branch
        && name == default_branch
    {
        return Ok(None);
    }

    if let Some(commit) = expected_commit {
        if get_worktrees(root)?
            .iter()
            .any(|worktree| worktree.branch.as_deref() == Some(name))
        {
            return Err(format!(
                "Branch '{name}' retained because it is checked out in another worktree"
            ));
        }
        let reference = format!("refs/heads/{name}");
        let deleted = git(
            ["update-ref", "--no-deref", "-d", &reference, commit],
            Some(root),
        )?;
        if deleted.exit_code != 0 {
            return Err(format!(
                "Conditional deletion of branch '{name}' failed; it may have changed since validation\n{}",
                deleted.stderr.trim()
            ));
        }
        let keys = git(["config", "--local", "--name-only", "--list"], Some(root))?;
        if keys.exit_code != 0 {
            return Err(format!(
                "Branch '{name}' deleted, but failed to read branch configuration\n{}",
                keys.stderr.trim()
            ));
        }
        let section = format!("branch.{name}");
        if keys.stdout.lines().any(|key| {
            key.rsplit_once('.')
                .is_some_and(|(prefix, _)| prefix == section)
        }) {
            let cleanup = git(
                ["config", "--local", "--remove-section", &section],
                Some(root),
            )?;
            if cleanup.exit_code != 0 {
                return Err(format!(
                    "Branch '{name}' deleted, but failed to remove its configuration\n{}",
                    cleanup.stderr.trim()
                ));
            }
        }
        return Ok(Some(name.to_string()));
    }

    let output = git(
        [
            OsString::from("branch"),
            OsString::from("-D"),
            OsString::from(name),
        ],
        Some(root),
    )?;
    if output.exit_code == 0 {
        Ok(Some(name.to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{parse_options, select_candidate};
    use crate::repo::Worktree;

    #[test]
    fn parses_rm_options() {
        let options = parse_options(&[
            OsString::from("a"),
            OsString::from("b"),
            OsString::from("--force"),
            OsString::from("--no-fetch"),
        ])
        .expect("rm options should parse");
        assert!(options.force);
        assert!(options.no_fetch);
        assert_eq!(options.names, vec!["a", "b"]);
    }

    #[test]
    fn selected_candidate_keeps_actual_branch_after_move() {
        let worktrees = vec![Worktree {
            path: PathBuf::from("/repo/renamed"),
            name: "renamed".to_string(),
            branch: Some("feature".to_string()),
            mtime: 0,
        }];

        let candidate =
            select_candidate(&worktrees, "renamed".to_string()).expect("candidate should resolve");

        assert_eq!(candidate.name, "renamed");
        assert_eq!(candidate.branch.as_deref(), Some("feature"));
    }

    fn test_git(path: &std::path::Path, args: &[&str]) -> String {
        let output = crate::repo::git(args.iter().copied(), Some(path)).expect("git should run");
        assert_eq!(output.exit_code, 0, "git {args:?}: {}", output.stderr);
        output.stdout.trim().to_string()
    }

    #[test]
    fn removal_checks_fetched_default_history_without_feature_remote() {
        use super::{
            RemovalCandidate, SafetyContext, check_safety, load_default_commit, remove_candidate,
        };
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        let temp_root = if cfg!(unix) {
            PathBuf::from("/tmp/agents")
        } else {
            std::env::temp_dir().join("agents")
        };
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = temp_root.join(format!("gwt-rm-{}-{nonce}", std::process::id()));
        let remote = temp.join("remote");
        let root = temp.join("local");
        fs::create_dir_all(&remote).unwrap();
        fs::create_dir_all(&root).unwrap();
        test_git(&remote, &["init", "--initial-branch=main"]);
        test_git(&remote, &["config", "user.name", "Gwt Test"]);
        test_git(&remote, &["config", "user.email", "gwt@example.invalid"]);
        test_git(&remote, &["commit", "--allow-empty", "-m", "base"]);
        test_git(
            &root,
            &["clone", "--bare", remote.to_str().unwrap(), ".bare"],
        );
        fs::write(root.join(".git"), "gitdir: .bare\n").unwrap();
        test_git(&root, &["config", "user.name", "Gwt Test"]);
        test_git(&root, &["config", "user.email", "gwt@example.invalid"]);
        test_git(&root, &["worktree", "add", "main", "main"]);
        test_git(
            &root,
            &["worktree", "add", "-b", "feature", "renamed", "main"],
        );
        let path = root.join("renamed");
        let candidate = RemovalCandidate {
            name: "renamed".to_string(),
            path: path.clone(),
            branch: Some("feature".to_string()),
            commit: None,
        };
        let initial = load_default_commit(&root, Some("main"), false).unwrap();
        test_git(&path, &["commit", "--allow-empty", "-m", "feature"]);
        let candidate = RemovalCandidate {
            commit: Some(test_git(&path, &["rev-parse", "HEAD"])),
            ..candidate
        };
        test_git(&path, &["push", "-u", "origin", "feature"]);
        let context = SafetyContext {
            default_branch: Some("main".to_string()),
            default_commit: initial.clone(),
        };
        assert!(
            check_safety(&context, &candidate)
                .unwrap()
                .iter()
                .any(|issue| issue.contains("not merged"))
        );

        test_git(&remote, &["merge", "--ff-only", "feature"]);
        test_git(&remote, &["branch", "-D", "feature"]);
        test_git(&root, &["update-ref", "-d", "refs/remotes/origin/feature"]);
        assert_eq!(
            load_default_commit(&root, Some("main"), true).unwrap(),
            initial
        );
        assert_eq!(test_git(&root, &["rev-parse", "main"]), initial);
        let merged = SafetyContext {
            default_branch: Some("main".to_string()),
            default_commit: load_default_commit(&root, Some("main"), false).unwrap(),
        };
        assert!(check_safety(&merged, &candidate).unwrap().is_empty());

        let expected = candidate.commit.as_deref().unwrap();
        assert!(
            super::try_delete_branch(&root, Some("feature"), Some("main"), Some(expected))
                .unwrap_err()
                .contains("checked out")
        );
        let prepared = super::prepare_removal(
            &merged,
            RemovalCandidate {
                name: candidate.name.clone(),
                path: candidate.path.clone(),
                branch: candidate.branch.clone(),
                commit: None,
            },
        )
        .unwrap();
        assert_eq!(prepared.commit.as_deref(), Some(expected));
        test_git(
            &path,
            &["commit", "--allow-empty", "-m", "after validation"],
        );
        let advanced = test_git(&path, &["rev-parse", "HEAD"]);
        let failure = remove_candidate(&root, prepared, false, Some("main")).unwrap_err();
        assert!(failure.contains("Worktree 'renamed' removed, but branch cleanup failed"));
        assert!(failure.contains("Conditional deletion"));
        assert!(!path.exists());
        assert_eq!(
            test_git(&root, &["rev-parse", "refs/heads/feature"]),
            advanced
        );
        assert_eq!(
            test_git(&root, &["config", "branch.feature.remote"]),
            "origin"
        );
        test_git(&root, &["worktree", "add", "renamed", "feature"]);
        test_git(&path, &["reset", "--hard", expected]);

        fs::write(path.join("dirty"), "untracked").unwrap();
        assert!(
            check_safety(&merged, &candidate)
                .unwrap()
                .iter()
                .any(|issue| issue.contains("Uncommitted"))
        );
        fs::remove_file(path.join("dirty")).unwrap();
        test_git(&path, &["checkout", "--detach"]);
        let detached = RemovalCandidate {
            branch: None,
            ..candidate
        };
        assert!(
            check_safety(&merged, &detached)
                .unwrap()
                .iter()
                .any(|issue| issue.contains("detached HEAD"))
        );
        test_git(&path, &["checkout", "feature"]);
        let candidate = RemovalCandidate {
            branch: Some("feature".to_string()),
            ..detached
        };
        let default = RemovalCandidate {
            name: "main".to_string(),
            path: root.join("main"),
            branch: Some("main".to_string()),
            commit: Some(initial.clone()),
        };
        assert!(
            check_safety(&merged, &default)
                .unwrap()
                .iter()
                .any(|issue| issue.contains("is the default branch"))
        );
        let invalid = SafetyContext {
            default_commit: "missing-ref".to_string(),
            ..merged
        };
        assert!(
            check_safety(&invalid, &candidate)
                .unwrap()
                .iter()
                .any(|issue| issue.contains("Failed to check ancestry"))
        );
        assert!(load_default_commit(&root, None, false).is_err());
        assert!(load_default_commit(&root, Some("missing"), true).is_err());
        assert!(load_default_commit(&root, Some("missing"), false).is_err());
        test_git(
            &root,
            &[
                "remote",
                "set-url",
                "origin",
                temp.join("absent").to_str().unwrap(),
            ],
        );
        assert!(load_default_commit(&root, Some("main"), false).is_err());
        assert!(load_default_commit(&root, Some("main"), true).is_ok());
        remove_candidate(&root, candidate, false, Some("main")).unwrap();
        assert!(!path.exists());
        let branch =
            crate::repo::git(["show-ref", "--verify", "refs/heads/feature"], Some(&root)).unwrap();
        assert_ne!(branch.exit_code, 0);
        let config =
            crate::repo::git(["config", "--get", "branch.feature.remote"], Some(&root)).unwrap();
        assert_eq!(config.exit_code, 1);
        test_git(
            &root,
            &["worktree", "add", "-b", "forced", "forced", "main"],
        );
        let forced_path = root.join("forced");
        test_git(&forced_path, &["commit", "--allow-empty", "-m", "unmerged"]);
        fs::write(forced_path.join("dirty"), "dirty").unwrap();
        remove_candidate(
            &root,
            RemovalCandidate {
                name: "forced".to_string(),
                path: forced_path.clone(),
                branch: Some("forced".to_string()),
                commit: None,
            },
            true,
            Some("main"),
        )
        .unwrap();
        assert!(!forced_path.exists());
        assert_ne!(
            crate::repo::git(["show-ref", "--verify", "refs/heads/forced"], Some(&root))
                .unwrap()
                .exit_code,
            0
        );
        fs::remove_dir_all(temp).unwrap();
    }
}
