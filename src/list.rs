use std::ffi::OsString;
use std::fs;
use std::thread;

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{
    WorktreeInfo, ensure_gwt_setup, format_age, git, git_in_worktree, parse_worktree_list,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SyncStatus {
    NoRemote,
    Synced,
    Ahead,
    Behind,
    Diverged,
}

#[derive(Clone, Debug)]
struct EnrichedWorktree {
    info: WorktreeInfo,
    dirty: bool,
    mtime: u64,
    sync_status: SyncStatus,
    sync_checked: bool,
}

#[derive(Default)]
struct ListOptions {
    json: bool,
    names: bool,
    clean: bool,
    dirty: bool,
    synced: bool,
    ahead: bool,
    behind: bool,
    no_remote: bool,
    no_fetch: bool,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let options = parse_options(args)?;
    let root = ensure_gwt_setup()?;
    let output = git(["worktree", "list", "--porcelain"], Some(&root))?;
    if output.exit_code != 0 {
        return Err("Error: Failed to list worktrees".to_string());
    }

    let filtered = parse_worktree_list(&output.stdout)
        .into_iter()
        .filter(|worktree| !worktree.is_bare)
        .collect::<Vec<_>>();

    if filtered.is_empty() {
        println!("No worktrees found");
        return Ok(());
    }

    let has_filters = options.clean
        || options.dirty
        || options.synced
        || options.ahead
        || options.behind
        || options.no_remote;
    let needs_sync = options.synced || options.ahead || options.behind || options.no_remote;

    if needs_sync && !options.no_fetch {
        let fetch = git(["fetch", "--all"], Some(&root))?;
        if fetch.exit_code != 0 {
            eprintln!("Warning: Failed to fetch remotes");
        }
    }

    if options.names && !has_filters {
        for worktree in filtered {
            println!("{}", worktree.name);
        }
        return Ok(());
    }

    let upstream_map = if needs_sync {
        Some(load_upstream_map(&root)?)
    } else {
        None
    };

    let mut enriched = thread::scope(|scope| {
        let mut tasks = Vec::new();
        for worktree in filtered {
            let upstream = worktree.branch.as_ref().and_then(|branch| {
                upstream_map
                    .as_ref()
                    .and_then(|map| map.get(branch).cloned())
            });
            tasks.push(scope.spawn(move || enrich_worktree(worktree, upstream, needs_sync)));
        }

        let mut results = Vec::new();
        for task in tasks {
            let result = task
                .join()
                .map_err(|_| "Error: worker thread panicked".to_string())?;
            results.push(result?);
        }
        Ok::<Vec<EnrichedWorktree>, String>(results)
    })?;

    if has_filters {
        enriched.retain(|worktree| {
            (!options.clean || !worktree.dirty)
                && (!options.dirty || worktree.dirty)
                && (!options.synced || worktree.sync_status == SyncStatus::Synced)
                && (!options.ahead
                    || matches!(
                        worktree.sync_status,
                        SyncStatus::Ahead | SyncStatus::Diverged
                    ))
                && (!options.behind
                    || matches!(
                        worktree.sync_status,
                        SyncStatus::Behind | SyncStatus::Diverged
                    ))
                && (!options.no_remote || worktree.sync_status == SyncStatus::NoRemote)
        });
    }

    if options.names {
        for worktree in enriched {
            println!("{}", worktree.info.name);
        }
        return Ok(());
    }

    if enriched.is_empty() {
        println!("No matching worktrees");
        return Ok(());
    }

    if options.json {
        print_json(&enriched);
        return Ok(());
    }

    let max_name = enriched
        .iter()
        .map(|worktree| worktree.info.name.len())
        .max()
        .unwrap_or(0);
    for worktree in enriched {
        let name = format!("{:width$}", worktree.info.name, width = max_name);
        let branch = worktree.info.branch.as_deref().unwrap_or("(detached)");
        let short_commit = worktree
            .info
            .commit
            .as_deref()
            .map(|commit| commit.chars().take(7).collect::<String>())
            .unwrap_or_default();
        let mut flags = Vec::new();
        if worktree.dirty {
            flags.push("dirty".to_string());
        }
        if worktree.info.locked.is_some() {
            flags.push("locked".to_string());
        }
        if worktree.sync_checked && worktree.sync_status != SyncStatus::Synced {
            flags.push(sync_status_label(worktree.sync_status).to_string());
        }
        let mut parts = vec![name];
        if !short_commit.is_empty() {
            parts.push(short_commit);
        }
        parts.push(branch.to_string());
        if !flags.is_empty() {
            parts.push(format!("[{}]", flags.join(", ")));
        }
        let age = format_age(worktree.mtime);
        if !age.is_empty() {
            parts.push(age);
        }
        println!("{}", parts.join("  "));
    }

    Ok(())
}

fn parse_options(args: &[OsString]) -> AppResult<ListOptions> {
    let mut options = ListOptions::default();
    for arg in args {
        match arg_to_str(arg)? {
            "--json" | "-j" => options.json = true,
            "--names" | "-n" => options.names = true,
            "--clean" | "-c" => options.clean = true,
            "--dirty" | "-d" => options.dirty = true,
            "--synced" | "-s" => options.synced = true,
            "--ahead" | "-a" => options.ahead = true,
            "--behind" | "-b" => options.behind = true,
            "--no-remote" => options.no_remote = true,
            "--no-fetch" | "-F" => options.no_fetch = true,
            "--help" | "-h" => {
                println!(
                    "gwt list [--json] [--names] [--clean] [--dirty] [--synced] [--ahead] [--behind] [--no-remote] [--no-fetch]"
                );
                return Err(String::new());
            }
            other => return Err(format!("Error: unknown list option '{other}'")),
        }
    }
    Ok(options)
}

fn load_upstream_map(
    root: &std::path::Path,
) -> AppResult<std::collections::HashMap<String, String>> {
    let output = git(
        [
            "for-each-ref",
            "--format=%(refname:short) %(upstream:short)",
            "refs/heads/",
        ],
        Some(root),
    )?;
    let mut map = std::collections::HashMap::new();
    if output.exit_code != 0 {
        return Ok(map);
    }

    for line in output.stdout.lines() {
        if line.is_empty() {
            continue;
        }
        if let Some((branch, upstream)) = line.split_once(' ') {
            if !upstream.trim().is_empty() {
                map.insert(branch.to_string(), upstream.trim().to_string());
            }
        }
    }
    Ok(map)
}

fn enrich_worktree(
    info: WorktreeInfo,
    upstream: Option<String>,
    needs_sync: bool,
) -> AppResult<EnrichedWorktree> {
    let status = git_in_worktree(&info.path, &["status", "--porcelain"])?;
    let dirty = status.exit_code == 0 && !status.stdout.trim().is_empty();
    let mtime = fs::metadata(&info.path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let mut sync_status = SyncStatus::NoRemote;
    let mut sync_checked = false;

    if needs_sync && info.branch.is_some() {
        sync_checked = true;
        if let Some(upstream) = upstream {
            let ahead_ref = format!("{upstream}..HEAD");
            let behind_ref = format!("HEAD..{upstream}");
            let ahead = git_in_worktree(&info.path, &["rev-list", "--count", ahead_ref.as_str()])?;
            let behind =
                git_in_worktree(&info.path, &["rev-list", "--count", behind_ref.as_str()])?;
            let ahead_count = parse_count(ahead.exit_code, &ahead.stdout);
            let behind_count = parse_count(behind.exit_code, &behind.stdout);
            sync_status = match (ahead_count > 0, behind_count > 0) {
                (true, true) => SyncStatus::Diverged,
                (true, false) => SyncStatus::Ahead,
                (false, true) => SyncStatus::Behind,
                (false, false) => SyncStatus::Synced,
            };
        }
    }

    Ok(EnrichedWorktree {
        info,
        dirty,
        mtime,
        sync_status,
        sync_checked,
    })
}

fn parse_count(exit_code: i32, stdout: &str) -> u64 {
    if exit_code == 0 {
        stdout.trim().parse::<u64>().unwrap_or(0)
    } else {
        0
    }
}

fn print_json(worktrees: &[EnrichedWorktree]) {
    println!("[");
    for (index, worktree) in worktrees.iter().enumerate() {
        let mut fields = Vec::new();
        fields.push(format!(
            "    \"name\": {}",
            json_string(&worktree.info.name)
        ));
        fields.push(format!(
            "    \"path\": {}",
            json_string(&worktree.info.path.display().to_string())
        ));
        fields.push(match &worktree.info.commit {
            Some(commit) => format!("    \"commit\": {}", json_string(commit)),
            None => "    \"commit\": null".to_string(),
        });
        fields.push(match &worktree.info.branch {
            Some(branch) => format!("    \"branch\": {}", json_string(branch)),
            None => "    \"branch\": null".to_string(),
        });
        fields.push(format!("    \"dirty\": {}", worktree.dirty));
        fields.push(format!(
            "    \"locked\": {}",
            worktree.info.locked.is_some()
        ));
        if let Some(reason) = &worktree.info.locked {
            if !reason.is_empty() {
                fields.push(format!("    \"lockReason\": {}", json_string(reason)));
            }
        }
        if worktree.sync_checked {
            fields.push(format!(
                "    \"sync\": {}",
                json_string(sync_status_label(worktree.sync_status))
            ));
        }
        fields.push(format!(
            "    \"age\": {}",
            json_string(&format_age(worktree.mtime))
        ));

        println!("  {{");
        println!("{}", fields.join(",\n"));
        if index + 1 == worktrees.len() {
            println!("  }}");
        } else {
            println!("  }},");
        }
    }
    println!("]");
}

fn json_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
}

fn sync_status_label(status: SyncStatus) -> &'static str {
    match status {
        SyncStatus::NoRemote => "no-remote",
        SyncStatus::Synced => "synced",
        SyncStatus::Ahead => "ahead",
        SyncStatus::Behind => "behind",
        SyncStatus::Diverged => "diverged",
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::parse_options;

    #[test]
    fn parses_list_options() {
        let options = parse_options(&[
            OsString::from("--json"),
            OsString::from("--ahead"),
            OsString::from("--no-fetch"),
        ])
        .expect("options should parse");
        assert!(options.json);
        assert!(options.ahead);
        assert!(options.no_fetch);
    }
}
