#!/usr/bin/env bun

import { defineCommand, runCommand, showUsage } from "citty";
import { clone } from "./commands/clone";
import { add } from "./commands/add";
import { list } from "./commands/list";
import { rm } from "./commands/rm";
import { init } from "./commands/init";
import { cd } from "./commands/cd";
import { edit } from "./commands/edit";
import { run } from "./commands/run";
import { shell } from "./commands/shell";
import { sync } from "./commands/sync";
import { pr } from "./commands/pr";
import { mr } from "./commands/mr";
import { lock, unlock, move } from "./commands/lock";
import { install } from "./commands/install";
import { update } from "./commands/update";
import { getCurrentVersion } from "./core/repo";

const cloneCmd = defineCommand({
  meta: {
    name: "clone",
    description: "Clone repo as bare + create default worktree",
  },
  args: {
    url: {
      type: "positional",
      description: "Repository URL",
      required: true,
    },
    dest: {
      type: "positional",
      description: "Destination directory",
      required: false,
    },
  },
  run({ args }) {
    return clone(args.url, args.dest);
  },
});

const initCmd = defineCommand({
  meta: {
    name: "init",
    description: "Initialize gwt in existing bare worktree repo",
  },
  run() {
    return init();
  },
});

const addCmd = defineCommand({
  meta: {
    name: "add",
    description: "Create new worktree from branch",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: true,
    },
    from: {
      type: "string",
      alias: "f",
      description: "Source branch",
    },
    "no-fetch": {
      type: "boolean",
      alias: "n",
      description: "Skip fetching remotes",
      default: false,
    },
  },
  run({ args }) {
    return add(args.name, { from: args.from, noFetch: args["no-fetch"] });
  },
});

const rmCmd = defineCommand({
  meta: {
    name: "rm",
    description: "Remove worktree(s)",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name(s)",
      required: true,
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Force removal",
      default: false,
    },
  },
  run({ args }) {
    const names = [args.name, ...(args._ as string[] || [])];
    return rm(names, { force: args.force });
  },
});

const listCmd = defineCommand({
  meta: {
    name: "list",
    description: "List all worktrees",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    names: {
      type: "boolean",
      description: "Output only worktree names",
      default: false,
    },
    clean: {
      type: "boolean",
      description: "Only worktrees with no uncommitted changes",
      default: false,
    },
    dirty: {
      type: "boolean",
      description: "Only worktrees with uncommitted changes",
      default: false,
    },
    synced: {
      type: "boolean",
      description: "Only worktrees in sync with remote",
      default: false,
    },
    ahead: {
      type: "boolean",
      description: "Only worktrees ahead of remote",
      default: false,
    },
    behind: {
      type: "boolean",
      description: "Only worktrees behind remote",
      default: false,
    },
    "no-remote": {
      type: "boolean",
      description: "Only worktrees without a remote tracking branch",
      default: false,
    },
    "no-fetch": {
      type: "boolean",
      alias: "n",
      description: "Skip fetching remotes",
      default: false,
    },
  },
  run({ args }) {
    return list({
      json: args.json,
      names: args.names,
      clean: args.clean,
      dirty: args.dirty,
      synced: args.synced,
      ahead: args.ahead,
      behind: args.behind,
      noRemote: args["no-remote"],
      noFetch: args["no-fetch"],
    });
  },
});

const cdCmd = defineCommand({
  meta: {
    name: "cd",
    description: "Change to worktree (interactive if no name)",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: false,
    },
  },
  run({ args }) {
    return cd(args.name);
  },
});

const editCmd = defineCommand({
  meta: {
    name: "edit",
    description: "Open worktree in IDE and cd there",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: false,
    },
    add: {
      type: "boolean",
      alias: "a",
      description: "Add to current VS Code/Cursor workspace",
      default: false,
    },
  },
  run({ args }) {
    return edit(args.name, { add: args.add });
  },
});

const runCmd = defineCommand({
  meta: {
    name: "run",
    description: "Run command in worktree (use -- before child flags)",
  },
  args: {
    worktree: {
      type: "string",
      alias: "w",
      description: "Worktree name",
    },
  },
  run({ args }) {
    const cmd = args._ as string[];
    return run(cmd, args.worktree);
  },
});

const lockCmd = defineCommand({
  meta: {
    name: "lock",
    description: "Lock worktree to prevent removal",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: true,
    },
    reason: {
      type: "string",
      alias: "r",
      description: "Lock reason",
    },
  },
  run({ args }) {
    return lock(args.name, args.reason);
  },
});

const unlockCmd = defineCommand({
  meta: {
    name: "unlock",
    description: "Unlock worktree",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: true,
    },
  },
  run({ args }) {
    return unlock(args.name);
  },
});

const moveCmd = defineCommand({
  meta: {
    name: "move",
    description: "Move worktree to new path",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: true,
    },
    dest: {
      type: "positional",
      description: "New path",
      required: true,
    },
  },
  run({ args }) {
    return move(args.name, args.dest);
  },
});

const prCmd = defineCommand({
  meta: {
    name: "pr",
    description: "Open or create PR for worktree branch",
  },
  args: {
    action: {
      type: "positional",
      description: "Action: 'create' to create PR, omit to view existing",
      required: false,
    },
    name: {
      type: "string",
      alias: "w",
      description: "Worktree name",
    },
  },
  run({ args }) {
    return pr(args.action, args.name);
  },
});

const mrCmd = defineCommand({
  meta: {
    name: "mr",
    description: "Open or create GitLab MR for worktree branch",
  },
  args: {
    action: {
      type: "positional",
      description: "Action: 'create' to create MR, omit to view existing",
      required: false,
    },
    name: {
      type: "string",
      alias: "w",
      description: "Worktree name",
    },
  },
  run({ args }) {
    return mr(args.action, args.name);
  },
});

const syncCmd = defineCommand({
  meta: {
    name: "sync",
    description: "Fetch and pull --rebase in worktree",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
      required: false,
    },
    "no-fetch": {
      type: "boolean",
      alias: "n",
      description: "Skip fetching remotes",
      default: false,
    },
  },
  run({ args }) {
    return sync(args.name, { noFetch: args["no-fetch"] });
  },
});

const shellCmd = defineCommand({
  meta: {
    name: "shell",
    description: "Output shell integration (add to .bashrc/.zshrc)",
  },
  args: {
    shell: {
      type: "string",
      description: "Shell type (bash, zsh, fish)",
    },
  },
  run({ args }) {
    shell(args.shell);
  },
});

const installCmd = defineCommand({
  meta: {
    name: "install",
    description: "Install gwt binary and shell integration",
  },
  args: {
    dir: {
      type: "positional",
      description: "Install directory (default: ~/.local/bin)",
      required: false,
    },
  },
  run({ args }) {
    return install(args.dir);
  },
});

const updateCmd = defineCommand({
  meta: {
    name: "update",
    description: "Update gwt to latest release",
  },
  run() {
    return update();
  },
});

const main = defineCommand({
  meta: {
    name: "gwt",
    version: getCurrentVersion(),
    description: "Git Worktree Manager",
  },
  subCommands: {
    clone: cloneCmd,
    init: initCmd,
    add: addCmd,
    rm: rmCmd,
    list: listCmd,
    ls: listCmd,
    lock: lockCmd,
    unlock: unlockCmd,
    move: moveCmd,
    cd: cdCmd,
    edit: editCmd,
    run: runCmd,
    pr: prCmd,
    mr: mrCmd,
    sync: syncCmd,
    shell: shellCmd,
    install: installCmd,
    update: updateCmd,
  },
});

const rawArgs = process.argv.slice(2);

try {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const subName = rawArgs.find(arg => !arg.startsWith("-"));
    const sub = subName ? (main.subCommands as Record<string, any>)?.[subName] : undefined;
    await showUsage(sub ?? main);
  } else if (rawArgs.length === 1 && rawArgs[0] === "--version") {
    console.log(main.meta?.version ?? "");
  } else {
    await runCommand(main, { rawArgs });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
