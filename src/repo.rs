use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::AppResult;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub name: String,
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub locked: Option<String>,
    pub prunable: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Worktree {
    pub path: PathBuf,
    pub name: String,
    pub branch: Option<String>,
    pub mtime: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GwtConfig {
    pub version: Option<String>,
    pub default_branch: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub const AGENTS_MD: &str = include_str!("../assets/AGENTS.md");

pub fn git<I, S>(args: I, cwd: Option<&Path>) -> AppResult<CommandOutput>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new("git");
    command.args(args);
    if let Some(path) = cwd {
        command.current_dir(path);
    }
    let output = command
        .output()
        .map_err(|error| format!("Error: failed to run git\n{error}"))?;

    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub fn git_in_worktree(path: &Path, args: &[&str]) -> AppResult<CommandOutput> {
    git(args.iter().copied(), Some(path))
}

pub fn run_command(program: &str, args: &[&str], cwd: Option<&Path>) -> AppResult<CommandOutput> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = cwd {
        command.current_dir(path);
    }
    let output = command
        .output()
        .map_err(|error| format!("Error: failed to run {}\n{}", program, error))?;

    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub fn command_exists(program: &str) -> bool {
    let candidate = Path::new(program);
    if candidate.is_absolute() || candidate.components().count() > 1 {
        return is_executable(candidate);
    }

    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    for dir in std::env::split_paths(&path_var) {
        let path = dir.join(program);
        if is_executable(&path) {
            return true;
        }

        #[cfg(windows)]
        if candidate.extension().is_none() {
            for extension in windows_path_extensions() {
                if is_executable(&dir.join(format!("{program}{extension}"))) {
                    return true;
                }
            }
        }
    }

    false
}

pub fn find_gwt_root(start_dir: Option<&Path>) -> Option<PathBuf> {
    let start = match start_dir {
        Some(path) => path.to_path_buf(),
        None => std::env::current_dir().ok()?,
    };

    for dir in start.ancestors() {
        if dir.join(".bare").is_dir() {
            return Some(dir.to_path_buf());
        }

        let git_path = dir.join(".git");
        if git_path.is_file() {
            if let Ok(content) = fs::read_to_string(&git_path) {
                if content.starts_with("gitdir:") {
                    if let Some(parent) = dir.parent() {
                        if parent.join(".bare").is_dir() {
                            return Some(parent.to_path_buf());
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn get_gwt_config(root: &Path) -> Option<GwtConfig> {
    let config_path = root.join(".bare").join("config");
    let content = fs::read_to_string(config_path).ok()?;
    Some(GwtConfig {
        version: extract_config_value(&content, "gwt", "version"),
        default_branch: extract_config_value(&content, "gwt", "defaultBranch"),
    })
}

pub fn ensure_gwt_setup() -> AppResult<PathBuf> {
    let root = find_gwt_root(None).ok_or_else(|| {
        "Error: Not in a gwt-managed repository. Run 'gwt clone' or 'gwt init'.".to_string()
    })?;
    let config = get_gwt_config(&root).ok_or_else(|| {
        "Error: Found .bare but not gwt-managed. Run 'gwt init' to set up.".to_string()
    })?;
    if config.version.is_none() {
        Err("Error: Found .bare but not gwt-managed. Run 'gwt init' to set up.".to_string())
    } else {
        Ok(root)
    }
}

pub fn get_default_branch(root: &Path) -> Option<String> {
    get_gwt_config(root).and_then(|config| config.default_branch)
}

pub fn get_current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn get_worktrees(root: &Path) -> AppResult<Vec<Worktree>> {
    let output = git(["worktree", "list", "--porcelain"], Some(root))?;
    if output.exit_code != 0 {
        return Err("Error: Failed to list worktrees".to_string());
    }

    let mut worktrees = parse_worktree_list(&output.stdout)
        .into_iter()
        .filter(|worktree| !worktree.is_bare)
        .map(|worktree| {
            let mtime = fs::metadata(&worktree.path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(system_time_millis)
                .unwrap_or(0);
            Worktree {
                path: worktree.path,
                name: worktree.name,
                branch: worktree.branch,
                mtime,
            }
        })
        .collect::<Vec<_>>();

    worktrees.sort_by(|left, right| right.mtime.cmp(&left.mtime));
    Ok(worktrees)
}

pub fn format_age(mtime: u64) -> String {
    if mtime == 0 {
        return String::new();
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let diff = now.saturating_sub(mtime);
    let minutes = diff / 60_000;
    let hours = diff / 3_600_000;
    let days = diff / 86_400_000;

    if days > 0 {
        format!("{days}d ago")
    } else if hours > 0 {
        format!("{hours}h ago")
    } else if minutes > 0 {
        format!("{minutes}m ago")
    } else {
        "just now".to_string()
    }
}

pub fn parse_worktree_list(output: &str) -> Vec<WorktreeInfo> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    trimmed
        .split("\n\n")
        .filter_map(parse_worktree_entry)
        .collect()
}

pub fn detect_default_branch(root: &Path) -> AppResult<String> {
    let symbolic_ref = git(["symbolic-ref", "refs/remotes/origin/HEAD"], Some(root))?;
    if symbolic_ref.exit_code == 0 {
        return Ok(symbolic_ref
            .stdout
            .trim()
            .trim_start_matches("refs/remotes/origin/")
            .to_string());
    }

    for branch in ["master", "main", "trunk", "develop", "default"] {
        let result = git(
            [
                OsString::from("show-ref"),
                OsString::from("--verify"),
                OsString::from(format!("refs/remotes/origin/{branch}")),
            ],
            Some(root),
        )?;
        if result.exit_code == 0 {
            return Ok(branch.to_string());
        }
    }

    let branches = git(["branch", "-r"], Some(root))?;
    if branches.exit_code == 0 {
        for line in branches.stdout.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.contains("->") {
                return Ok(trimmed.trim_start_matches("origin/").to_string());
            }
        }
    }

    if let Some(branch) = git_string(root, ["config", "init.defaultBranch"])? {
        if !branch.is_empty() {
            return Ok(branch);
        }
    }

    Ok("master".to_string())
}

fn parse_worktree_entry(entry: &str) -> Option<WorktreeInfo> {
    let mut path = None;
    let mut commit = None;
    let mut branch = None;
    let mut is_bare = false;
    let mut locked = None;
    let mut prunable = None;

    for line in entry.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            commit = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(value.trim_start_matches("refs/heads/").to_string());
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            branch = None;
        } else if line == "locked" {
            locked = Some(String::new());
        } else if let Some(value) = line.strip_prefix("locked ") {
            locked = Some(value.to_string());
        } else if line == "prunable" {
            prunable = Some(String::new());
        } else if let Some(value) = line.strip_prefix("prunable ") {
            prunable = Some(value.to_string());
        }
    }

    let path = path?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())?;

    Some(WorktreeInfo {
        path,
        name,
        commit,
        branch,
        is_bare,
        locked,
        prunable,
    })
}

fn extract_config_value(content: &str, section: &str, key: &str) -> Option<String> {
    let header = format!("[{section}]");
    let mut in_section = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_section = trimmed == header;
            continue;
        }

        if !in_section {
            continue;
        }

        if let Some((candidate_key, candidate_value)) = trimmed.split_once('=') {
            if candidate_key.trim() == key {
                return Some(
                    candidate_value
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .to_string(),
                );
            }
        }
    }

    None
}

fn system_time_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

pub fn path_arg(path: &Path) -> AppResult<OsString> {
    if path.as_os_str().is_empty() {
        Err("Error: empty path is not allowed".to_string())
    } else {
        Ok(path.as_os_str().to_os_string())
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        match fs::metadata(path) {
            Ok(metadata) => metadata.is_file() && metadata.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }

    #[cfg(windows)]
    {
        path.is_file()
    }
}

#[cfg(windows)]
fn windows_path_extensions() -> Vec<String> {
    let pathext =
        std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
    pathext
        .to_string_lossy()
        .split(';')
        .filter_map(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

pub fn git_string<const N: usize>(root: &Path, args: [&str; N]) -> AppResult<Option<String>> {
    let output = git(args, Some(root))?;
    if output.exit_code == 0 {
        Ok(Some(output.stdout.trim().to_string()))
    } else {
        Ok(None)
    }
}

pub fn http_get_text(url: &str, headers: &[(&str, &str)]) -> AppResult<String> {
    let mut command = Command::new("curl");
    command.arg("-fsSL");
    for (name, value) in headers {
        command.arg("-H").arg(format!("{}: {}", name, value));
    }
    command.arg(url);
    let output = command
        .output()
        .map_err(|error| format!("Error: failed to run curl\n{}", error))?;
    if !output.status.success() {
        return Err(format!(
            "curl failed (exit {}): {}",
            output.status.code().unwrap_or(1),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn download_to_path(url: &str, path: &Path, headers: &[(&str, &str)]) -> AppResult<()> {
    let mut command = Command::new("curl");
    command.arg("-fsSL");
    for (name, value) in headers {
        command.arg("-H").arg(format!("{}: {}", name, value));
    }
    command.arg("-o").arg(path).arg(url);
    let status = command
        .status()
        .map_err(|error| format!("Error: failed to run curl\n{}", error))?;
    if !status.success() {
        return Err(format!("curl failed (exit {})", status.code().unwrap_or(1)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_config_value, parse_worktree_list};

    #[test]
    fn parses_worktree_list() {
        let worktrees = parse_worktree_list(
            "worktree /repo/.bare\nbare\n\nworktree /repo/master\nHEAD abc123\nbranch refs/heads/master\n\nworktree /repo/feat\nHEAD def456\nbranch refs/heads/feat\nlocked reason",
        );

        assert_eq!(worktrees.len(), 3);
        assert!(worktrees[0].is_bare);
        assert_eq!(worktrees[1].name, "master");
        assert_eq!(worktrees[2].locked.as_deref(), Some("reason"));
    }

    #[test]
    fn extracts_config_values() {
        let content = "[gwt]\nversion = 0.3.7\ndefaultBranch = master\n";
        assert_eq!(
            extract_config_value(content, "gwt", "version").as_deref(),
            Some("0.3.7")
        );
        assert_eq!(
            extract_config_value(content, "gwt", "defaultBranch").as_deref(),
            Some("master")
        );
    }
}
