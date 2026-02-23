# gwt

A fast git worktree manager using bare repository workflow.

## Why

Git worktrees let you check out multiple branches simultaneously in separate directories. This is useful for:

- Reviewing PRs without stashing work
- Running tests on one branch while developing on another
- Comparing implementations side-by-side

gwt simplifies the workflow by using a bare repository structure where each branch lives in its own directory.

## Prerequisites

- Git 2.17+ (for worktree move/remove support)

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/3axap4eHko/gwt/master/install.sh | sh
```

This downloads the binary and runs `gwt install`, which:
- Copies gwt to `~/.local/bin` (warns if not in PATH)
- Adds shell integration (`eval "$(gwt shell)"`) to your rc file

To update to the latest version:

```bash
gwt update
```

### From source

Requires [Bun](https://bun.sh) runtime.

```bash
bun install
bun run build
./dist/gwt install  # Install binary and shell integration
```

## Quick start

```bash
# Clone a repo
gwt clone git@github.com:user/repo.git
cd repo

# Create a new worktree for a feature branch
gwt add my-feature

# Switch between worktrees
gwt cd master
gwt cd my-feature

# Open worktree in IDE and switch there
gwt edit master

# Run a command inside a worktree
gwt run -w master -- npm test

# List all worktrees
gwt list

# Fetch and pull latest
gwt sync master

# Open PR in browser
gwt pr -w my-feature

# Remove a worktree
gwt rm my-feature
```

## Shell integration

Shell integration is set up automatically by `gwt install`. Without it, `gwt cd` and `gwt edit` print the worktree path but cannot change your shell's directory. The integration also provides tab completion.

To set it up manually, add to your shell config:

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

### `gwt add <name> [-f, --from <branch>] [-n, --no-fetch]`

Create a new worktree. Fetches all remotes first (skip with `-n`). If the branch exists on any remote, it tracks that branch (prefers origin). Otherwise creates a new branch from the specified source (defaults to the default branch).

```bash
gwt add feature-login           # New branch from default
gwt add feature-api -f develop  # New branch from develop
gwt add existing-branch         # Tracks remote if exists
gwt add quick-fix -n            # Skip fetching remotes
```

### `gwt rm <name> [-f, --force]`

Remove a worktree. By default, checks for uncommitted changes and unpushed commits.

```bash
gwt rm feature-done
gwt rm feature-wip -f  # Skip safety checks
```

### `gwt list [--json] [--names]`

List all worktrees with branch, commit, dirty status, locked status, and age.

```bash
gwt list          # Table output
gwt list --json   # JSON output for scripting
gwt list --names  # Bare names, one per line
```

### `gwt cd [name]`

Switch to a worktree. Without a name, shows an interactive selector.

```bash
gwt cd master   # Switch to master
gwt cd          # Interactive selector
```

### `gwt edit [name] [-a, --add]`

Open a worktree in your IDE and switch there. Without a name, shows an interactive selector. Use `--add` to add the worktree to the current VS Code/Cursor workspace instead of opening a new window.

```bash
gwt edit master      # Open master in IDE and cd there
gwt edit             # Interactive selector
gwt edit feature -a  # Add to current VS Code workspace
```

### `gwt run [-w name] [--] <cmd...>`

Run a command inside a worktree. Without `-w`, shows an interactive selector. Use `--` before child flags to prevent gwt from consuming them.

```bash
gwt run -w master npm test              # Run npm test in master worktree
gwt run -w my-feature npm run build     # Run build in feature worktree
gwt run echo hello                      # Interactive worktree selector
gwt run -w master -- npm test --watch   # Use -- before child flags
```

The child process inherits stdin/stdout/stderr. If the command exits with a non-zero code, gwt exits with the same code. Signals (SIGINT, SIGTERM, etc.) are forwarded to the child process.

### `gwt sync [name] [-n, --no-fetch]`

Fetch all remotes and pull with rebase in a worktree. Without a name, shows an interactive selector.

```bash
gwt sync master   # Fetch + pull --rebase in master
gwt sync          # Interactive selector
gwt sync master -n  # Skip fetch, just pull
```

### `gwt pr [create] [-w name]`

Open or create a GitHub PR for a worktree's branch. Requires [gh CLI](https://cli.github.com).

```bash
gwt pr              # View PR for selected worktree
gwt pr -w feature   # View PR for feature branch
gwt pr create       # Create PR in browser
```

### `gwt mr [create] [-w name]`

Open or create a GitLab MR for a worktree's branch. Requires [glab CLI](https://gitlab.com/gitlab-org/cli).

```bash
gwt mr              # View MR for selected worktree
gwt mr -w feature   # View MR for feature branch
gwt mr create       # Create MR in browser
```

### `gwt lock <name> [-r, --reason <text>]`

Lock a worktree to prevent removal.

```bash
gwt lock feature                    # Lock
gwt lock feature -r "do not touch"  # Lock with reason
```

### `gwt unlock <name>`

Unlock a previously locked worktree.

### `gwt move <name> <new-path>`

Move a worktree to a new path. The destination must be inside the repo root.

### `gwt shell [type]`

Output shell integration script. Auto-detects shell type if not specified.

```bash
gwt shell       # Auto-detect
gwt shell bash
gwt shell zsh
gwt shell fish
```

### `gwt install [dir]`

Install gwt binary and shell integration. Copies the binary to `~/.local/bin` (or custom directory), appends shell integration to your rc file, and warns if the install directory is not in PATH. Safe to run multiple times (idempotent).

```bash
gwt install                # Install to ~/.local/bin
gwt install /usr/local/bin # Install to custom directory
```

### `gwt update`

Update gwt to the latest GitHub release. Compares current version against the latest release and replaces the binary in-place.

## Configuration

### IDE

Set your preferred IDE for `gwt edit`:

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
  master/         # Default branch worktree
  feature-a/      # Feature branch worktree
  feature-b/      # Another worktree
  AGENTS.md       # AI agent instructions (created by clone/init)
```

All worktrees must live under the repo root. Moving or creating worktrees outside the root is not supported.

## Troubleshooting

### `gwt cd` prints path but doesn't change directory

Shell integration is not set up. Run `gwt install` to set it up automatically, or add `eval "$(gwt shell)"` to your shell config manually. See [Shell integration](#shell-integration).

### No IDE found

Set your preferred IDE: `git config --global gwt.ide code`

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
