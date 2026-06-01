use std::path::{Component, Path};

pub fn is_valid_worktree_name(name: &str) -> bool {
    if name.is_empty() || name.trim().is_empty() {
        return false;
    }
    if name == ".bare" || name == ".git" || name == "@" {
        return false;
    }
    if name.contains("..")
        || name.starts_with('-')
        || name.ends_with(".lock")
        || name.contains('/')
        || name.contains("@{")
    {
        return false;
    }

    if name.bytes().any(|byte| {
        byte <= 0x1f
            || byte == 0x7f
            || matches!(byte, b'~' | b'^' | b':' | b'?' | b'*' | b'\\' | b'[' | b']')
    }) {
        return false;
    }

    for part in name.split('/') {
        if part.starts_with('.') || part.ends_with('.') {
            return false;
        }
    }

    true
}

pub fn is_valid_worktree_relative_path(path: &Path) -> bool {
    let Some(value) = path.to_str() else {
        return false;
    };
    if value.is_empty() || value.contains('\\') {
        return false;
    }

    let mut has_part = false;
    for component in path.components() {
        match component {
            Component::Normal(_) => has_part = true,
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return false;
            }
        }
    }

    has_part
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{is_valid_worktree_name, is_valid_worktree_relative_path};

    #[test]
    fn rejects_reserved_names() {
        assert!(!is_valid_worktree_name(".bare"));
        assert!(!is_valid_worktree_name(".git"));
    }

    #[test]
    fn rejects_invalid_patterns() {
        assert!(!is_valid_worktree_name("../foo"));
        assert!(!is_valid_worktree_name("feature/login"));
        assert!(!is_valid_worktree_name("foo.lock"));
    }

    #[test]
    fn accepts_normal_worktree_names() {
        assert!(is_valid_worktree_name("feature-login"));
        assert!(is_valid_worktree_name("master"));
    }

    #[test]
    fn rejects_paths_outside_worktree() {
        assert!(!is_valid_worktree_relative_path(Path::new("")));
        assert!(!is_valid_worktree_relative_path(Path::new(".")));
        assert!(!is_valid_worktree_relative_path(Path::new("..")));
        assert!(!is_valid_worktree_relative_path(Path::new(
            "../node_modules"
        )));
        assert!(!is_valid_worktree_relative_path(Path::new("/tmp/cache")));
        assert!(!is_valid_worktree_relative_path(Path::new("apps\\web")));
    }

    #[test]
    fn accepts_paths_inside_worktree() {
        assert!(is_valid_worktree_relative_path(Path::new("node_modules")));
        assert!(is_valid_worktree_relative_path(Path::new(
            "apps/web/node_modules"
        )));
        assert!(is_valid_worktree_relative_path(Path::new(".venv")));
    }
}
