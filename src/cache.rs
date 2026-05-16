use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::AppResult;
use crate::arg_to_str;
use crate::repo::{ensure_gwt_setup, get_worktrees, git};
use crate::validation::is_valid_worktree_name;

pub struct CacheEntry {
    pub inputs: Vec<PathBuf>,
    pub target: PathBuf,
}

pub fn run(args: &[OsString]) -> AppResult<()> {
    let root = ensure_gwt_setup()?;
    let Some(arg) = args.first() else {
        let worktree = current_worktree(&root)?;
        return apply_all(&root, &worktree);
    };

    match arg_to_str(arg)? {
        "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        "unlink" => run_unlink(&root, &args[1..]),
        "prune" => run_prune(&root, &args[1..]),
        other if other.starts_with('-') => Err(format!("Error: unknown cache option '{other}'")),
        other => Err(format!("Error: unknown cache subcommand '{other}'")),
    }
}

fn run_unlink(root: &Path, args: &[OsString]) -> AppResult<()> {
    if let Some(arg) = args.first() {
        match arg_to_str(arg)? {
            "--help" | "-h" => {
                println!("gwt cache unlink");
                return Ok(());
            }
            other => return Err(format!("Error: unknown cache unlink option '{other}'")),
        }
    }
    let worktree = current_worktree(root)?;
    detach_all(root, &worktree)
}

fn run_prune(root: &Path, args: &[OsString]) -> AppResult<()> {
    let mut apply = false;
    for arg in args {
        match arg_to_str(arg)? {
            "--apply" => apply = true,
            "--help" | "-h" => {
                println!("gwt cache prune [--apply]");
                return Ok(());
            }
            other => return Err(format!("Error: unknown cache prune option '{other}'")),
        }
    }

    let entries = read_entries(root)?;
    let counts = cache_ref_counts(root, &entries)?;
    let disconnected = disconnected_cache_dirs(root, &counts)?;
    if disconnected.is_empty() {
        println!("No disconnected cache directories");
        return Ok(());
    }

    if !apply {
        println!("Disconnected cache directories:");
        for dir in &disconnected {
            println!("  {}", dir.display());
        }
        println!("Run 'gwt cache prune --apply' to remove them");
        return Ok(());
    }

    for dir in disconnected {
        fs::remove_dir_all(&dir).map_err(|error| {
            format!(
                "Error: failed to remove cache directory {}: {}",
                dir.display(),
                error
            )
        })?;
        println!("Removed {}", dir.display());
    }
    Ok(())
}

fn print_usage() {
    println!("gwt cache [unlink|prune [--apply]]");
}

pub fn apply_all(root: &Path, worktree: &Path) -> AppResult<()> {
    let entries = read_entries(root)?;
    require_entries(&entries)?;
    for entry in &entries {
        apply_entry(root, worktree, entry)?;
    }
    warn_disconnected_cache_dirs(root, &entries)?;
    Ok(())
}

pub fn detach_all(root: &Path, worktree: &Path) -> AppResult<()> {
    let entries = read_entries(root)?;
    require_entries(&entries)?;
    let mut counts = cache_ref_counts(root, &entries)?;
    for entry in &entries {
        detach_entry(root, worktree, &mut counts, entry)?;
    }
    warn_disconnected_cache_dirs_from_counts(root, &counts)?;
    Ok(())
}

fn require_entries(entries: &[CacheEntry]) -> AppResult<()> {
    if entries.is_empty() {
        Err("Error: no gwt.cache.* entries configured in .bare/config".to_string())
    } else {
        Ok(())
    }
}

fn current_worktree(root: &Path) -> AppResult<PathBuf> {
    let cwd = std::env::current_dir().map_err(|error| format!("Error: {error}"))?;
    let worktrees = get_worktrees(root)?;
    for worktree in &worktrees {
        if cwd == worktree.path || cwd.starts_with(&worktree.path) {
            return Ok(worktree.path.clone());
        }
    }
    Err("Error: current directory is not inside a worktree".to_string())
}

fn apply_entry(root: &Path, worktree: &Path, entry: &CacheEntry) -> AppResult<()> {
    let hash = hash_inputs(worktree, &entry.inputs)?;
    let store_dir = cache_root(root).join(&hash);
    let target_path = worktree.join(&entry.target);

    if !store_dir.exists() {
        prepare_cache_dir(root, &hash, &target_path, &entry.target)?;
    }

    match fs::symlink_metadata(&target_path) {
        Ok(meta) => {
            let file_type = meta.file_type();
            if file_type.is_symlink() {
                let existing = fs::read_link(&target_path).map_err(|error| {
                    format!(
                        "Error: failed to read symlink at {}: {}",
                        target_path.display(),
                        error
                    )
                })?;
                let desired = relative_cache_target(&entry.target, &hash)?;
                if existing == desired {
                    return Ok(());
                }
                fs::remove_file(&target_path).map_err(|error| {
                    format!(
                        "Error: failed to remove stale symlink {}: {}",
                        target_path.display(),
                        error
                    )
                })?;
            } else {
                return Err(format!(
                    "Error: '{}' already exists as a real path; run 'gwt cache unlink' first or move it aside",
                    target_path.display()
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Error: failed to inspect {}: {}",
                target_path.display(),
                error
            ));
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Error: failed to create parent directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    let link_target = relative_cache_target(&entry.target, &hash)?;
    create_symlink(&link_target, &target_path)?;
    eprintln!(
        "Cached {} -> .gwt/cache/{}",
        entry.target.display(),
        &hash[..12]
    );
    Ok(())
}

fn detach_entry(
    root: &Path,
    worktree: &Path,
    counts: &mut BTreeMap<String, usize>,
    entry: &CacheEntry,
) -> AppResult<()> {
    let target_path = worktree.join(&entry.target);
    let meta = match fs::symlink_metadata(&target_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Error: failed to inspect {}: {}",
                target_path.display(),
                error
            ));
        }
    };

    if !meta.file_type().is_symlink() {
        return Ok(());
    }

    let existing = fs::read_link(&target_path).map_err(|error| {
        format!(
            "Error: failed to read symlink at {}: {}",
            target_path.display(),
            error
        )
    })?;
    let Some(hash) = cache_hash_from_link(&existing) else {
        eprintln!(
            "Warning: {} is not a gwt cache symlink; leaving it unchanged",
            target_path.display()
        );
        return Ok(());
    };
    let store_dir = cache_root(root).join(&hash);
    if !store_dir.exists() {
        return Err(format!(
            "Error: cache content .gwt/cache/{} is missing; leaving {} unchanged",
            &hash[..12],
            target_path.display()
        ));
    }

    let users = counts.get(&hash).copied().unwrap_or(0);

    fs::remove_file(&target_path).map_err(|error| {
        format!(
            "Error: failed to remove symlink {}: {}",
            target_path.display(),
            error
        )
    })?;

    if users <= 1 {
        move_cache_dir(&store_dir, &target_path)?;
        decrement_ref_count(counts, &hash);
        eprintln!(
            "Uncached {} (moved from .gwt/cache/{})",
            entry.target.display(),
            &hash[..12]
        );
    } else {
        clone_cache_dir(&store_dir, &target_path)?;
        decrement_ref_count(counts, &hash);
        eprintln!(
            "Uncached {} (restored from .gwt/cache/{})",
            entry.target.display(),
            &hash[..12]
        );
    }
    Ok(())
}

pub fn read_entries(root: &Path) -> AppResult<Vec<CacheEntry>> {
    let config_path = root.join(".bare").join("config");
    let output = git(
        [
            OsString::from("config"),
            OsString::from("--file"),
            config_path.into_os_string(),
            OsString::from("--get-regexp"),
            OsString::from("^gwt\\.cache\\."),
        ],
        None,
    )?;
    if output.exit_code != 0 {
        return Ok(Vec::new());
    }
    parse_entries(&output.stdout)
}

fn parse_entries(raw: &str) -> AppResult<Vec<CacheEntry>> {
    let mut groups: BTreeMap<String, RawEntry> = BTreeMap::new();
    for line in raw.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(' ') else {
            continue;
        };
        let parts: Vec<&str> = key.splitn(4, '.').collect();
        if parts.len() != 4 || parts[0] != "gwt" || parts[1] != "cache" {
            continue;
        }
        let name = parts[2];
        let field = parts[3];
        let group = groups.entry(name.to_string()).or_default();
        match field {
            "input" => group.inputs.push(PathBuf::from(value)),
            "target" => group.target = Some(PathBuf::from(value)),
            _ => {}
        }
    }

    let mut entries = Vec::with_capacity(groups.len());
    for (name, raw) in groups {
        if !is_valid_worktree_name(&name) {
            return Err(format!("Error: invalid cache entry name '{name}'"));
        }
        if raw.inputs.is_empty() {
            return Err(format!(
                "Error: cache entry '{name}' has no 'input' configured"
            ));
        }
        let target = raw
            .target
            .ok_or_else(|| format!("Error: cache entry '{name}' has no 'target' configured"))?;
        if target.as_os_str().is_empty() {
            return Err(format!("Error: cache entry '{name}' has empty 'target'"));
        }
        if target.is_absolute() {
            return Err(format!(
                "Error: cache entry '{name}' target must be relative to the worktree"
            ));
        }
        entries.push(CacheEntry {
            inputs: raw.inputs,
            target,
        });
    }
    Ok(entries)
}

#[derive(Default)]
struct RawEntry {
    inputs: Vec<PathBuf>,
    target: Option<PathBuf>,
}

pub fn hash_inputs(worktree: &Path, inputs: &[PathBuf]) -> AppResult<String> {
    let mut ordered: Vec<&PathBuf> = inputs.iter().collect();
    ordered.sort_by(|left, right| left.as_os_str().cmp(right.as_os_str()));

    let mut hasher = Sha256::new();
    for input in ordered {
        let rel = input
            .to_str()
            .ok_or_else(|| "Error: cache input path is not valid UTF-8".to_string())?;
        let full = worktree.join(input);
        let bytes = fs::read(&full).map_err(|error| {
            format!(
                "Error: failed to read cache input '{}': {}",
                full.display(),
                error
            )
        })?;
        hasher.update((rel.len() as u64).to_be_bytes());
        hasher.update(rel.as_bytes());
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(&bytes);
    }
    let digest = hasher.finalize();
    Ok(hex_encode(&digest))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn prepare_cache_dir(root: &Path, hash: &str, target_path: &Path, target: &Path) -> AppResult<()> {
    let cache_dir = cache_root(root);
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Error: failed to create {}: {}", cache_dir.display(), error))?;

    let meta = match fs::symlink_metadata(target_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let final_dir = cache_dir.join(hash);
            fs::create_dir(&final_dir).map_err(|error| {
                format!(
                    "Error: failed to create empty cache directory {}: {}",
                    final_dir.display(),
                    error
                )
            })?;
            eprintln!(
                "Created empty cache for {} at .gwt/cache/{}",
                target.display(),
                &hash[..12]
            );
            return Ok(());
        }
        Err(error) => {
            return Err(format!(
                "Error: failed to inspect {}: {}",
                target_path.display(),
                error
            ));
        }
    };

    if meta.file_type().is_symlink() {
        return Err(format!(
            "Error: cache .gwt/cache/{} is missing and '{}' is a symlink; restore a real target first",
            &hash[..12],
            target.display()
        ));
    }
    if !meta.is_dir() {
        return Err(format!(
            "Error: cache target '{}' must be a directory",
            target.display()
        ));
    }

    let final_dir = cache_dir.join(hash);
    fs::rename(target_path, &final_dir).map_err(|error| {
        format!(
            "Error: failed to move {} into cache {}: {}",
            target_path.display(),
            final_dir.display(),
            error
        )
    })?;
    eprintln!(
        "Cached {} into .gwt/cache/{}",
        target.display(),
        &hash[..12]
    );
    Ok(())
}

pub fn relative_cache_target(target: &Path, hash: &str) -> AppResult<PathBuf> {
    let depth = target
        .parent()
        .map(|parent| parent.components().count())
        .unwrap_or(0);
    let mut path = PathBuf::new();
    for _ in 0..=depth {
        path.push("..");
    }
    path.push(".gwt");
    path.push("cache");
    path.push(hash);
    Ok(path)
}

fn cache_hash_from_link(link_target: &Path) -> Option<String> {
    let components = link_target
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    if components.len() < 3 {
        return None;
    }

    let hash = components[components.len() - 1];
    if components[components.len() - 2] == "cache"
        && components[components.len() - 3] == ".gwt"
        && is_cache_hash(hash)
    {
        Some(hash.to_string())
    } else {
        None
    }
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> AppResult<()> {
    std::os::unix::fs::symlink(target, link).map_err(|error| {
        format!(
            "Error: failed to create symlink {} -> {}: {}",
            link.display(),
            target.display(),
            error
        )
    })
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> AppResult<()> {
    std::os::windows::fs::symlink_dir(target, link).map_err(|error| {
        format!(
            "Error: failed to create symlink {} -> {}: {}",
            link.display(),
            target.display(),
            error
        )
    })
}

#[cfg(all(not(unix), not(windows)))]
fn create_symlink(_target: &Path, link: &Path) -> AppResult<()> {
    Err(format!(
        "Error: gwt cache is only supported on Unix and Windows; cannot create symlink at {}",
        link.display()
    ))
}

fn cache_root(root: &Path) -> PathBuf {
    root.join(".gwt").join("cache")
}

fn is_cache_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn cache_store_hashes(root: &Path) -> AppResult<BTreeSet<String>> {
    let mut hashes = BTreeSet::new();
    let dir = cache_root(root);
    let read_dir = match fs::read_dir(&dir) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(hashes),
        Err(error) => {
            return Err(format!(
                "Error: failed to read cache directory {}: {}",
                dir.display(),
                error
            ));
        }
    };

    for entry in read_dir {
        let entry = entry.map_err(|error| format!("Error: failed to read cache entry: {error}"))?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Error: failed to inspect cache entry {}: {}",
                entry.path().display(),
                error
            )
        })?;
        if !file_type.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(|value| value.to_string()) else {
            continue;
        };
        if is_cache_hash(&name) {
            hashes.insert(name);
        }
    }
    Ok(hashes)
}

fn cache_ref_counts(root: &Path, entries: &[CacheEntry]) -> AppResult<BTreeMap<String, usize>> {
    let mut counts = BTreeMap::new();
    for worktree in get_worktrees(root)? {
        for entry in entries {
            let target = worktree.path.join(&entry.target);
            if let Some(hash) = cache_link_hash(&target)? {
                *counts.entry(hash).or_insert(0) += 1;
            }
        }
    }
    Ok(counts)
}

fn cache_link_hash(target: &Path) -> AppResult<Option<String>> {
    let meta = match fs::symlink_metadata(target) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Error: failed to inspect {}: {}",
                target.display(),
                error
            ));
        }
    };
    if !meta.file_type().is_symlink() {
        return Ok(None);
    }

    let link = fs::read_link(target).map_err(|error| {
        format!(
            "Error: failed to read symlink at {}: {}",
            target.display(),
            error
        )
    })?;
    Ok(cache_hash_from_link(&link))
}

fn decrement_ref_count(counts: &mut BTreeMap<String, usize>, hash: &str) {
    if let Some(count) = counts.get_mut(hash) {
        *count = count.saturating_sub(1);
    }
    if counts.get(hash) == Some(&0) {
        counts.remove(hash);
    }
}

fn disconnected_cache_dirs(
    root: &Path,
    counts: &BTreeMap<String, usize>,
) -> AppResult<Vec<PathBuf>> {
    let store_hashes = cache_store_hashes(root)?;
    let root = cache_root(root);
    Ok(store_hashes
        .iter()
        .filter(|hash| counts.get(*hash).copied().unwrap_or(0) == 0)
        .map(|hash| root.join(hash))
        .collect())
}

fn warn_disconnected_cache_dirs(root: &Path, entries: &[CacheEntry]) -> AppResult<()> {
    let counts = cache_ref_counts(root, entries)?;
    warn_disconnected_cache_dirs_from_counts(root, &counts)
}

fn warn_disconnected_cache_dirs_from_counts(
    root: &Path,
    counts: &BTreeMap<String, usize>,
) -> AppResult<()> {
    let count = disconnected_cache_dirs(root, counts)?.len();
    if count > 0 {
        eprintln!(
            "Warning: {count} disconnected cache director{} found; run 'gwt cache prune' to inspect",
            if count == 1 { "y" } else { "ies" }
        );
    }
    Ok(())
}

fn move_cache_dir(src: &Path, dst: &Path) -> AppResult<()> {
    if dst.exists() {
        return Err(format!(
            "Error: refusing to overwrite existing path {}",
            dst.display()
        ));
    }

    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            clone_cache_dir(src, dst)?;
            fs::remove_dir_all(src).map_err(|error| {
                format!(
                    "Error: failed to remove cache directory {} after restore: {}",
                    src.display(),
                    error
                )
            })
        }
    }
}

fn clone_cache_dir(src: &Path, dst: &Path) -> AppResult<()> {
    if dst.exists() {
        return Err(format!(
            "Error: refusing to overwrite existing path {}",
            dst.display()
        ));
    }

    let options = clonetree::Options::new();
    if let Err(error) = clonetree::clone_tree(src, dst, &options) {
        if !matches!(&error, clonetree::Error::DestinationExists { .. }) {
            remove_partial_copy_dst(dst)?;
        }
        return Err(format!(
            "Error: failed to clone cache directory {} to {}: {}",
            src.display(),
            dst.display(),
            error
        ));
    }
    Ok(())
}

fn remove_partial_copy_dst(dst: &Path) -> AppResult<()> {
    let meta = match fs::symlink_metadata(dst) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Error: failed to inspect partial copy destination {}: {}",
                dst.display(),
                error
            ));
        }
    };

    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(dst).map_err(|error| {
            format!(
                "Error: failed to remove partial copy destination {}: {}",
                dst.display(),
                error
            )
        })
    } else {
        fs::remove_file(dst).map_err(|error| {
            format!(
                "Error: failed to remove partial copy destination {}: {}",
                dst.display(),
                error
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const OTHER_HASH: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    #[test]
    fn parses_entries_groups_by_subsection() {
        let raw = "gwt.cache.node_modules.input package-lock.json\n\
                   gwt.cache.node_modules.input package.json\n\
                   gwt.cache.node_modules.target node_modules\n\
                   gwt.cache.venv.input uv.lock\n\
                   gwt.cache.venv.target .venv\n";
        let entries = parse_entries(raw).expect("parse");
        assert_eq!(entries.len(), 2);
        let nm = entries
            .iter()
            .find(|entry| entry.target == Path::new("node_modules"))
            .unwrap();
        assert_eq!(
            nm.inputs,
            vec![
                PathBuf::from("package-lock.json"),
                PathBuf::from("package.json")
            ]
        );
        let venv = entries
            .iter()
            .find(|entry| entry.target == Path::new(".venv"))
            .unwrap();
        assert_eq!(venv.inputs, vec![PathBuf::from("uv.lock")]);
    }

    #[test]
    fn parses_rejects_missing_target() {
        let raw = "gwt.cache.x.input lock\n";
        assert!(parse_entries(raw).is_err());
    }

    #[test]
    fn parses_rejects_absolute_target() {
        let raw = "gwt.cache.x.input lock\n\
                   gwt.cache.x.target /etc\n";
        assert!(parse_entries(raw).is_err());
    }

    #[test]
    fn adopt_target_moves_existing_directory_into_cache() {
        let tmp = std::env::temp_dir().join(format!("gwt-cache-adopt-test-{}", std::process::id()));
        fs::remove_dir_all(&tmp).ok();
        let worktree = tmp.join("feature");
        let target = worktree.join("node_modules");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("marker"), b"cached").unwrap();

        prepare_cache_dir(&tmp, HASH, &target, Path::new("node_modules")).unwrap();

        assert!(!target.exists());
        assert_eq!(
            fs::read(tmp.join(".gwt").join("cache").join(HASH).join("marker")).unwrap(),
            b"cached"
        );
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn cache_miss_creates_empty_cache_directory_when_target_is_missing() {
        let tmp = std::env::temp_dir().join(format!("gwt-cache-empty-test-{}", std::process::id()));
        fs::remove_dir_all(&tmp).ok();
        let target = tmp.join("feature").join("node_modules");

        prepare_cache_dir(&tmp, HASH, &target, Path::new("node_modules")).unwrap();

        assert!(tmp.join(".gwt").join("cache").join(HASH).is_dir());
        assert!(!target.exists());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn clone_cache_dir_copies_directory_tree() {
        let tmp = std::env::temp_dir().join(format!("gwt-cache-clone-test-{}", std::process::id()));
        fs::remove_dir_all(&tmp).ok();
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        fs::create_dir_all(src.join("nested")).unwrap();
        fs::write(src.join("nested").join("marker"), b"cached").unwrap();

        clone_cache_dir(&src, &dst).unwrap();

        assert_eq!(
            fs::read(dst.join("nested").join("marker")).unwrap(),
            b"cached"
        );
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn disconnected_cache_dirs_uses_ref_counts() {
        let tmp = std::env::temp_dir().join(format!(
            "gwt-cache-disconnected-test-{}",
            std::process::id()
        ));
        fs::remove_dir_all(&tmp).ok();
        let cache = tmp.join(".gwt").join("cache");
        fs::create_dir_all(cache.join(HASH)).unwrap();
        fs::create_dir_all(cache.join(OTHER_HASH)).unwrap();
        fs::write(cache.join("not-a-cache"), b"ignored").unwrap();

        let mut counts = BTreeMap::new();
        counts.insert(HASH.to_string(), 1);
        let disconnected = disconnected_cache_dirs(&tmp, &counts).unwrap();

        assert_eq!(disconnected, vec![cache.join(OTHER_HASH)]);
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn decrement_ref_count_removes_zero_counts() {
        let mut counts = BTreeMap::new();
        counts.insert(HASH.to_string(), 2);

        decrement_ref_count(&mut counts, HASH);
        assert_eq!(counts.get(HASH), Some(&1));

        decrement_ref_count(&mut counts, HASH);
        assert!(!counts.contains_key(HASH));
    }

    #[test]
    fn relative_cache_target_top_level() {
        let path = relative_cache_target(Path::new("node_modules"), HASH).unwrap();
        assert_eq!(path, PathBuf::from(format!("../.gwt/cache/{HASH}")));
    }

    #[test]
    fn relative_cache_target_nested() {
        let path = relative_cache_target(Path::new("apps/web/node_modules"), HASH).unwrap();
        assert_eq!(path, PathBuf::from(format!("../../../.gwt/cache/{HASH}")));
    }

    #[test]
    fn hash_inputs_is_order_independent() {
        let tmp = std::env::temp_dir().join(format!("gwt-cache-test-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("a.txt"), b"alpha").unwrap();
        fs::write(tmp.join("b.txt"), b"beta").unwrap();
        let h1 = hash_inputs(&tmp, &[PathBuf::from("a.txt"), PathBuf::from("b.txt")]).unwrap();
        let h2 = hash_inputs(&tmp, &[PathBuf::from("b.txt"), PathBuf::from("a.txt")]).unwrap();
        fs::remove_dir_all(&tmp).ok();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn cache_hash_from_link_accepts_cache_links() {
        assert_eq!(
            cache_hash_from_link(Path::new(&format!("../.gwt/cache/{HASH}"))),
            Some(HASH.to_string())
        );
        assert_eq!(
            cache_hash_from_link(Path::new(&format!("../../.gwt/cache/{HASH}"))),
            Some(HASH.to_string())
        );
    }

    #[test]
    fn cache_hash_from_link_rejects_non_cache_links() {
        assert_eq!(
            cache_hash_from_link(Path::new("../other/cache/abc123")),
            None
        );
        assert_eq!(
            cache_hash_from_link(Path::new("../.gwt/cache/abc123")),
            None
        );
    }
}
