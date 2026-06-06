use std::collections::{HashMap, HashSet};
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
}

struct SafetyContext {
    default_branch: Option<String>,
    tracking_refs: HashMap<String, String>,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let default_branch = get_default_branch(&root);

    if !options.force && !options.no_fetch {
        let fetch = git(["fetch", "--all"], Some(&root))?;
        if fetch.exit_code != 0 {
            return Err(format!(
                "Error: Failed to fetch remotes\n{}",
                fetch.stderr.trim()
            ));
        }
    }

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
        let context = SafetyContext {
            default_branch,
            tracking_refs: load_tracking_refs(&root)?,
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
    })
}

fn prepare_removal(
    context: &SafetyContext,
    candidate: RemovalCandidate,
) -> AppResult<RemovalCandidate> {
    if !candidate.path.exists() {
        return Err(format!("Error: Worktree '{}' not found", candidate.name));
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

    let branch_deleted =
        try_delete_branch(root, candidate.branch.as_deref(), force, default_branch)?;
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

    if let Some(tracking_ref) = context.tracking_refs.get(branch) {
        let ahead_ref = format!("{tracking_ref}..HEAD");
        let behind_ref = format!("HEAD..{tracking_ref}");
        let ahead = git_in_worktree(
            &candidate.path,
            &["rev-list", "--count", ahead_ref.as_str()],
        )?;
        let behind = git_in_worktree(
            &candidate.path,
            &["rev-list", "--count", behind_ref.as_str()],
        )?;

        if ahead.exit_code != 0 {
            issues.push("Failed to check unpushed commits".to_string());
        } else if let Ok(count) = ahead.stdout.trim().parse::<u64>()
            && count > 0
        {
            issues.push(format!(
                "{count} unpushed commit{}",
                if count > 1 { "s" } else { "" }
            ));
        }

        if behind.exit_code != 0 {
            issues.push("Failed to check commits behind remote".to_string());
        } else if let Ok(count) = behind.stdout.trim().parse::<u64>()
            && count > 0
        {
            issues.push(format!(
                "{count} commit{} behind remote",
                if count > 1 { "s" } else { "" }
            ));
        }
    } else {
        issues.push(format!("Branch '{branch}' not pushed to remote"));
    }

    Ok(issues)
}

fn load_tracking_refs(root: &std::path::Path) -> AppResult<HashMap<String, String>> {
    let upstreams = load_upstream_refs(root)?;
    let remote_branches = load_remote_branch_refs(root)?;
    let mut tracking_refs = remote_branches;
    for (branch, upstream) in upstreams {
        tracking_refs.insert(branch, upstream);
    }
    Ok(tracking_refs)
}

fn load_upstream_refs(root: &std::path::Path) -> AppResult<HashMap<String, String>> {
    let output = git(
        [
            OsString::from("for-each-ref"),
            OsString::from("--format=%(refname:short)%09%(upstream:short)"),
            OsString::from("refs/heads"),
        ],
        Some(root),
    )?;
    let mut refs = HashMap::new();
    if output.exit_code != 0 {
        return Ok(refs);
    }

    for line in output.stdout.lines() {
        let Some((branch, upstream)) = line.split_once('\t') else {
            continue;
        };
        let upstream = upstream.trim();
        if !upstream.is_empty() {
            refs.insert(branch.to_string(), upstream.to_string());
        }
    }
    Ok(refs)
}

fn load_remote_branch_refs(root: &std::path::Path) -> AppResult<HashMap<String, String>> {
    let remote_names = load_remote_names(root)?;
    let scan = git(
        [
            OsString::from("for-each-ref"),
            OsString::from("--format=%(refname:short)"),
            OsString::from("refs/remotes"),
        ],
        Some(root),
    )?;
    let mut refs = HashMap::new();
    if scan.exit_code != 0 {
        return Ok(refs);
    }

    for reference in scan.stdout.lines() {
        if reference.ends_with("/HEAD") {
            continue;
        }

        let Some((remote, branch)) = split_remote_ref(reference, &remote_names) else {
            continue;
        };
        let replace = remote == "origin" || !refs.contains_key(branch);
        if replace {
            refs.insert(branch.to_string(), reference.to_string());
        }
    }
    Ok(refs)
}

fn load_remote_names(root: &std::path::Path) -> AppResult<HashSet<String>> {
    let output = git(["remote"], Some(root))?;
    let mut names = HashSet::new();
    if output.exit_code != 0 {
        return Ok(names);
    }
    for line in output.stdout.lines() {
        let remote = line.trim();
        if !remote.is_empty() {
            names.insert(remote.to_string());
        }
    }
    Ok(names)
}

fn split_remote_ref<'remote, 'reference>(
    reference: &'reference str,
    remote_names: &'remote HashSet<String>,
) -> Option<(&'remote str, &'reference str)> {
    remote_names
        .iter()
        .filter_map(|remote| {
            reference
                .strip_prefix(remote)
                .and_then(|rest| rest.strip_prefix('/'))
                .map(|branch| (remote.as_str(), branch))
        })
        .max_by_key(|(remote, _)| remote.len())
}

fn try_delete_branch(
    root: &std::path::Path,
    branch: Option<&str>,
    force: bool,
    default_branch: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(name) = branch else {
        return Ok(None);
    };
    if let Some(default_branch) = default_branch
        && name == default_branch
    {
        return Ok(None);
    }

    let flag = if force { "-D" } else { "-d" };
    let output = git(
        [
            OsString::from("branch"),
            OsString::from(flag),
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
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{parse_options, select_candidate, split_remote_ref};
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
    fn splits_remote_ref_with_slash_remote_name() {
        let remote_names = HashSet::from(["origin".to_string(), "team/fork".to_string()]);

        assert_eq!(
            split_remote_ref("team/fork/feature", &remote_names),
            Some(("team/fork", "feature"))
        );
    }

    #[test]
    fn ignores_unknown_remote_ref_prefix() {
        let remote_names = HashSet::from(["origin".to_string()]);

        assert_eq!(split_remote_ref("unknown/feature", &remote_names), None);
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
}
