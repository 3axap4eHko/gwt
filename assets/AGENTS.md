# Repository structure

This repository uses a bare repository worktree layout managed by `gwt`. The structure is:

```
repo/
  .bare/        # Bare git repository (do not modify directly)
  .git          # File (not directory) pointing to .bare
  AGENTS.md     # This file
  master/       # Worktree for the master branch
  breanch-x/    # Worktree for the breanch-x branch
  ...           # Each branch has its own directory
```

Each subdirectory (except .bare) is a separate git worktree checked out to its own branch. They share the same git history but have independent working trees.

## Rules

- Stay in your assigned worktree directory. Do not cd to sibling worktrees or the repo root unless explicitly asked.
- Run `git status`, `git diff`, `git commit`, etc. from inside a worktree directory, not the repo root.
- Do not modify `.bare/` or the root `.git` file.
- Do not run `git checkout` or `git switch` inside a worktree - each worktree is locked to its branch.
- To see all worktrees: `git worktree list` (or `gwt list` if gwt is installed).
