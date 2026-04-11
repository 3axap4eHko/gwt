use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::AppResult;
use crate::repo::command_exists;

const RC_FILES: [(&str, &str); 3] = [
    ("zsh", ".zshrc"),
    ("bash", ".bashrc"),
    ("fish", ".config/fish/config.fish"),
];
const WINDOWS_PROFILE_LINE: &str = "gwt.exe shell powershell | Out-String | Invoke-Expression";
const WINDOWS_PATH_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($env:GWT_INSTALL_DIR).TrimEnd('\')
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @()
if ($current) {
  $parts = $current -split ';' | Where-Object { $_ }
}
$normalized = @($parts | ForEach-Object {
  try {
    [System.IO.Path]::GetFullPath($_).TrimEnd('\')
  } catch {
    $_.TrimEnd('\')
  }
})
if ($normalized -contains $target) {
  Write-Output 'unchanged'
  exit 0
}
$newPath = if ($current -and $current.Trim()) { "$current;$target" } else { $target }
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
Write-Output 'updated'
"#;
const WINDOWS_PROFILE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$profilePath = $PROFILE.CurrentUserAllHosts
$profileDir = Split-Path -Parent $profilePath
if (!(Test-Path -LiteralPath $profileDir)) {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
}
if (!(Test-Path -LiteralPath $profilePath)) {
  New-Item -ItemType File -Force -Path $profilePath | Out-Null
}
$line = 'gwt.exe shell powershell | Out-String | Invoke-Expression'
$content = Get-Content -Raw -LiteralPath $profilePath
if ($content -match [regex]::Escape($line)) {
  Write-Output "existing:$profilePath"
  exit 0
}
Add-Content -LiteralPath $profilePath -Value "`n$line`n"
Write-Output "added:$profilePath"
"#;

pub fn run(args: &[std::ffi::OsString]) -> AppResult<()> {
    if args.len() > 1 {
        return Err("Error: install accepts at most one directory argument".to_string());
    }

    let os = std::env::consts::OS;
    let install_dir = if let Some(dir) = args.first() {
        PathBuf::from(dir)
    } else {
        default_install_dir(os)?
    };
    let dest = install_dir.join(binary_name_for_os(os));
    let src = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut actions = Vec::new();
    fs::create_dir_all(&install_dir).map_err(|error| error.to_string())?;

    if is_same_file(&src, &dest) {
        actions.push(format!("gwt already installed at {}", dest.display()));
    } else {
        fs::copy(&src, &dest).map_err(|error| error.to_string())?;
        set_executable(&dest)?;
        actions.push(format!("Copied gwt to {}", dest.display()));
    }

    if !is_on_path(&install_dir) {
        if os == "windows" {
            if add_windows_path(&install_dir)? {
                actions.push(format!("Added {} to your user PATH", install_dir.display()));
            } else {
                actions.push(format!(
                    "{} is not in PATH. Add it to your user PATH manually.",
                    install_dir.display()
                ));
            }
        } else {
            let home = std::env::var_os("HOME").ok_or_else(|| "$HOME is not set".to_string())?;
            let shell = detect_shell();
            let rc_path = RC_FILES
                .iter()
                .find(|(name, _)| *name == shell)
                .map(|(_, path)| PathBuf::from(home).join(path));
            let path_line = if shell == "fish" {
                format!("fish_add_path {}", install_dir.display())
            } else {
                format!("export PATH=\"{}:$PATH\"", install_dir.display())
            };
            let shell_config = rc_path
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "shell config".to_string());
            actions.push(format!(
                "{} is not in PATH. Add to your {}:\n  {}",
                install_dir.display(),
                shell_config,
                path_line
            ));
        }
    }

    if os == "windows" {
        let profile_updates = ensure_windows_shell_integration()?;
        if profile_updates.added.is_empty() {
            if profile_updates.available_hosts == 0 {
                actions.push(format!(
                    "PowerShell profile not updated automatically. Add this line manually:\n  {}",
                    WINDOWS_PROFILE_LINE
                ));
            }
        } else {
            for path in profile_updates.added {
                actions.push(format!("Added shell integration to {}", path.display()));
            }
        }
        println!("{}", actions.join("\n"));
        if actions
            .iter()
            .any(|action| action.contains("PATH") || action.contains("shell integration"))
        {
            println!();
            println!("Restart PowerShell or open a new terminal.");
        }
        return Ok(());
    }

    let home = std::env::var_os("HOME").ok_or_else(|| "$HOME is not set".to_string())?;
    let shell = detect_shell();
    let rc_path = RC_FILES
        .iter()
        .find(|(name, _)| *name == shell)
        .map(|(_, path)| PathBuf::from(home).join(path));
    if let Some(rc_path) = &rc_path {
        let rc_content = fs::read_to_string(rc_path).unwrap_or_default();
        if !rc_content.contains("gwt shell") {
            let line = shell_integration_line(shell);
            let mut content = rc_content;
            content.push('\n');
            content.push_str(line);
            content.push('\n');
            fs::write(rc_path, content).map_err(|error| error.to_string())?;
            actions.push(format!("Added shell integration to {}", rc_path.display()));
        }
    }

    println!("{}", actions.join("\n"));
    if let Some(rc_path) = rc_path {
        if actions
            .iter()
            .any(|action| action.contains("Added shell integration"))
        {
            println!();
            println!("Restart your shell or run: source {}", rc_path.display());
        }
    }
    Ok(())
}

struct WindowsProfileUpdates {
    added: Vec<PathBuf>,
    available_hosts: usize,
}

fn detect_shell() -> &'static str {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.contains("fish") {
        "fish"
    } else if shell.contains("zsh") {
        "zsh"
    } else {
        "bash"
    }
}

fn shell_integration_line(shell: &str) -> &'static str {
    if shell == "fish" {
        "gwt shell fish | source"
    } else {
        "eval \"$(gwt shell)\""
    }
}

fn is_on_path(dir: &Path) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    std::env::split_paths(&path_var).any(|entry| same_path(&entry, dir))
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn set_executable(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn binary_name_for_os(os: &str) -> &'static str {
    if os == "windows" { "gwt.exe" } else { "gwt" }
}

fn default_install_dir(os: &str) -> AppResult<PathBuf> {
    if os == "windows" {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|value| PathBuf::from(value).join("AppData").join("Local"))
            });
        let base = local_app_data
            .ok_or_else(|| "Neither %LOCALAPPDATA% nor %USERPROFILE% is set".to_string())?;
        Ok(base.join("Programs").join("gwt").join("bin"))
    } else {
        let home = std::env::var_os("HOME").ok_or_else(|| "$HOME is not set".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("bin"))
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(a), Ok(b)) => a == b,
        _ => normalize_path(left) == normalize_path(right),
    }
}

fn normalize_path(path: &Path) -> String {
    let mut value = path.as_os_str().to_string_lossy().replace('\\', "/");
    while value.ends_with('/') {
        value.pop();
    }
    if cfg!(windows) {
        value.make_ascii_lowercase();
    }
    value
}

fn add_windows_path(dir: &Path) -> AppResult<bool> {
    let Some(host) = preferred_powershell_host() else {
        return Ok(false);
    };

    let output = Command::new(host)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_PATH_SCRIPT,
        ])
        .env("GWT_INSTALL_DIR", dir)
        .output()
        .map_err(|error| format!("Error: failed to run {host}\n{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Error: failed to update user PATH\n{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "updated")
}

fn ensure_windows_shell_integration() -> AppResult<WindowsProfileUpdates> {
    let hosts = powershell_hosts();
    let mut added = Vec::new();

    for host in &hosts {
        if let Some(path) = add_windows_profile_line(host)? {
            added.push(path);
        }
    }

    Ok(WindowsProfileUpdates {
        added,
        available_hosts: hosts.len(),
    })
}

fn add_windows_profile_line(host: &str) -> AppResult<Option<PathBuf>> {
    let output = Command::new(host)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_PROFILE_SCRIPT,
        ])
        .output()
        .map_err(|error| format!("Error: failed to run {host}\n{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Error: failed to update PowerShell profile\n{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(path) = stdout.trim().strip_prefix("added:") {
        return Ok(Some(PathBuf::from(path)));
    }

    Ok(None)
}

fn preferred_powershell_host() -> Option<&'static str> {
    if command_exists("powershell") {
        Some("powershell")
    } else if command_exists("pwsh") {
        Some("pwsh")
    } else {
        None
    }
}

fn powershell_hosts() -> Vec<&'static str> {
    let mut hosts = Vec::new();
    if command_exists("powershell") {
        hosts.push("powershell");
    }
    if command_exists("pwsh") {
        hosts.push("pwsh");
    }
    hosts
}
