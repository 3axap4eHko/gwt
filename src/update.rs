use std::ffi::OsString;
use std::fs;
use std::process::{Command, Stdio};

use crate::AppResult;
use crate::repo::{command_exists, download_to_path, http_get_text};

const REPO: &str = "3axap4eHko/gwt";
const WINDOWS_UPDATE_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$source = $env:GWT_UPDATE_SOURCE
$destination = $env:GWT_UPDATE_DESTINATION
for ($i = 0; $i -lt 200; $i++) {
  try {
    Copy-Item -LiteralPath $source -Destination $destination -Force
    Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    exit 0
  } catch {
    Start-Sleep -Milliseconds 100
  }
}
exit 1
"#;

pub fn run(args: &[OsString]) -> AppResult<()> {
    if !args.is_empty() {
        return Err("Error: update does not accept arguments".to_string());
    }

    let binary_name = release_binary_name(std::env::consts::OS, std::env::consts::ARCH)?;

    let api_url = format!("https://api.github.com/repos/{}/releases/latest", REPO);
    let release = http_get_text(&api_url, &[("User-Agent", "gwt")])?;
    let latest = json_string_value(&release, "tag_name")
        .ok_or_else(|| "Failed to parse latest release".to_string())?;
    let current = env!("CARGO_PKG_VERSION");
    let latest_bare = latest.trim_start_matches('v');
    if latest_bare == current {
        println!("Already up to date ({})", current);
        return Ok(());
    }

    let url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        REPO, latest, binary_name
    );
    println!("Downloading gwt {} ({})...", latest, binary_name);

    let temp_path = if std::env::consts::OS == "windows" {
        std::env::temp_dir().join("gwt-update.exe")
    } else {
        std::env::temp_dir().join("gwt-update")
    };
    download_to_path(&url, &temp_path, &[])?;
    set_executable(&temp_path)?;

    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    if std::env::consts::OS == "windows" {
        stage_windows_update(&temp_path, &current_exe)?;
        println!("Update staged. The binary will be replaced after this process exits.");
        return Ok(());
    }

    let _ = fs::remove_file(&current_exe);
    fs::copy(&temp_path, &current_exe).map_err(|error| error.to_string())?;
    set_executable(&current_exe)?;
    let _ = fs::remove_file(temp_path);

    println!("Updated gwt {} -> {}", current, latest_bare);
    Ok(())
}

fn release_binary_name(os: &str, arch: &str) -> AppResult<String> {
    let os = match os {
        "linux" => "linux",
        "macos" => "darwin",
        "windows" => "windows",
        other => return Err(format!("Unsupported platform: {}", other)),
    };
    let arch = match arch {
        "x86_64" => "x64",
        "aarch64" if os != "windows" => "arm64",
        other => return Err(format!("Unsupported architecture: {}", other)),
    };
    let suffix = if os == "windows" { ".exe" } else { "" };
    Ok(format!("gwt-{}-{}{}", os, arch, suffix))
}

fn json_string_value(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let start = json.find(&needle)?;
    let rest = &json[start + needle.len()..];
    let colon = rest.find(':')?;
    let value = rest[colon + 1..].trim_start();
    let mut chars = value.chars();
    if chars.next()? != '"' {
        return None;
    }
    let mut output = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            output.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(output);
        } else {
            output.push(ch);
        }
    }
    None
}

fn set_executable(path: &std::path::Path) -> AppResult<()> {
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

fn stage_windows_update(source: &std::path::Path, destination: &std::path::Path) -> AppResult<()> {
    let host = if command_exists("powershell") {
        "powershell"
    } else if command_exists("pwsh") {
        "pwsh"
    } else {
        return Err("Error: PowerShell is required for Windows self-update".to_string());
    };

    let script_path = std::env::temp_dir().join(format!("gwt-update-{}.ps1", std::process::id()));
    fs::write(&script_path, WINDOWS_UPDATE_SCRIPT).map_err(|error| error.to_string())?;

    Command::new(host)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path)
        .env("GWT_UPDATE_SOURCE", source)
        .env("GWT_UPDATE_DESTINATION", destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Error: failed to start Windows updater\n{}", error))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::release_binary_name;

    #[test]
    fn builds_windows_asset_name() {
        assert_eq!(
            release_binary_name("windows", "x86_64").as_deref(),
            Ok("gwt-windows-x64.exe")
        );
    }

    #[test]
    fn rejects_unsupported_windows_architecture() {
        assert!(release_binary_name("windows", "aarch64").is_err());
    }
}
