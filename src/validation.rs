pub fn is_valid_worktree_name(name: &str) -> bool {
    if name.is_empty() || name.trim().is_empty() {
        return false;
    }
    if name == ".bare" || name == ".git" || name == "@" {
        return false;
    }
    if name.contains("..")
        || name.starts_with('/')
        || name.starts_with('-')
        || name.ends_with('/')
        || name.ends_with(".lock")
        || name.contains("//")
        || name.contains("@{")
    {
        return false;
    }

    if name
        .bytes()
        .any(|byte| byte <= 0x1f || byte == 0x7f || matches!(byte, b'~' | b'^' | b':' | b'?' | b'*' | b'\\' | b'[' | b']'))
    {
        return false;
    }

    for part in name.split('/') {
        if part.starts_with('.') || part.ends_with('.') {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::is_valid_worktree_name;

    #[test]
    fn rejects_reserved_names() {
        assert!(!is_valid_worktree_name(".bare"));
        assert!(!is_valid_worktree_name(".git"));
    }

    #[test]
    fn rejects_invalid_patterns() {
        assert!(!is_valid_worktree_name("../foo"));
        assert!(!is_valid_worktree_name("foo//bar"));
        assert!(!is_valid_worktree_name("foo.lock"));
    }

    #[test]
    fn accepts_normal_branch_like_names() {
        assert!(is_valid_worktree_name("feature/login"));
        assert!(is_valid_worktree_name("master"));
    }
}
