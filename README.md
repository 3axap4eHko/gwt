# gwt

A fast git worktree manager using bare repository workflow.

## Why

Git worktrees let you check out multiple branches simultaneously in separate directories. This is useful for:

- Reviewing PRs without stashing work
- Running tests on one branch while developing on another
- Comparing implementations side-by-side

gwt simplifies the workflow by using a bare repository structure where each branch lives in its own directory.

## Prerequisites

- [Bun](https://bun.sh) runtime (for building from source)
- Git 2.15+ (for worktree support)

## Installation

### From source

```bash
bun install
bun run build
# Copy dist/gwt to your PATH
```

### Cross-platform builds

```bash
bun run build:all
# Outputs: dist/gwt-linux-x64, dist/gwt-darwin-arm64, dist/gwt-windows-x64.exe
```

## Quick start

```bash
# Clone a repo
gwt clone git@github.com:user/repo.git
cd repo

# Create a new worktree for a feature branch
gwt add my-feature

# Switch between worktrees
gwt cd main
gwt cd my-feature

# List all worktrees
gwt list

# Remove a worktree
gwt rm my-feature
```

## Shell integration

Without shell integration, `gwt cd` prints the worktree path but cannot change your shell's directory (child processes cannot modify the parent shell's working directory). Add this to your shell config to enable directory switching:

```bash
# Bash/Zsh: add to ~/.bashrc or ~/.zshrc
eval "$(gwt shell)"

# Fish: add to ~/.config/fish/config.fish
gwt shell fish | source
```

## Commands

### `gwt clone <url> [dest]`

Clone a repository using the bare worktree structure.

```bash
gwt clone git@github.com:user/repo.git
gwt clone git@github.com:user/repo.git my-project
```

### `gwt init`

Initialize gwt in an existing bare worktree repository. Use this when you already have a bare repository with worktrees set up manually and want to add gwt management. For new repositories, use `gwt clone` instead.

### `gwt add <name> [-f, --from <branch>]`

Create a new worktree. If the branch exists on remote, it tracks that branch. Otherwise creates a new branch from the specified source (defaults to main/master).

```bash
gwt add feature-login           # New branch from default
gwt add feature-api -f develop  # New branch from develop
gwt add existing-branch         # Tracks remote if exists
```

### `gwt rm <name> [-f, --force]`

Remove a worktree. By default, checks for uncommitted changes and unpushed commits.

```bash
gwt rm feature-done
gwt rm feature-wip -f  # Skip safety checks
```

### `gwt list`

List all worktrees with their branches and paths.

### `gwt cd [name] [-o, --open] [-e, --edit] [-x, --exec <cmd>]`

Switch to a worktree. Without a name, shows an interactive selector.

```bash
gwt cd main              # Switch to main
gwt cd                   # Interactive selector
gwt cd main -o           # Open in file manager
gwt cd main -e           # Open in IDE
gwt cd main -x npm test  # Run command in worktree
gwt cd main -x npm run build -- --watch  # All args after -x are the command
```

Note: The `--exec` flag captures all remaining arguments as the command to run. This feature requires Unix (uses `/dev/tty` for interactive terminal support) and is not available on Windows.

### `gwt shell [type]`

Output shell integration script. Auto-detects shell type if not specified.

```bash
gwt shell       # Auto-detect
gwt shell bash
gwt shell zsh
gwt shell fish
```

## Configuration

### IDE

Set your preferred IDE for `gwt cd -e`:

```bash
git config --global gwt.ide code    # VS Code
git config --global gwt.ide cursor  # Cursor
git config --global gwt.ide zed     # Zed
git config --global gwt.ide nvim    # Neovim
```

IDE detection order:
1. `git config gwt.ide` (recommended)
2. `$VISUAL` environment variable
3. First available from: `zed`, `nvim`, `cursor`, `code`
4. `$EDITOR` environment variable (fallback)

## Directory structure

After cloning, the repository structure looks like:

```
repo/
  .bare/          # Bare git repository
  main/           # Main branch worktree
  feature-a/      # Feature branch worktree
  feature-b/      # Another worktree
  AGENTS.md       # AI agent instructions (created by clone/init)
```

## Troubleshooting

### `gwt cd` prints path but doesn't change directory

Shell integration is not set up. Add `eval "$(gwt shell)"` to your shell config. See [Shell integration](#shell-integration).

### No IDE found

Set your preferred IDE: `git config --global gwt.ide code`

### `--exec` fails with "requires an interactive terminal"

The `--exec` feature requires a TTY. It won't work in non-interactive contexts like CI pipelines or when stdin is redirected.

## Development

```bash
bun install
bun run dev -- <command>  # Run in development
bun run test              # Run tests
bun run test:coverage     # Run tests with coverage
bun run lint              # Lint code
```

## License

MIT
