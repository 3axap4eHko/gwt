#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";

function extractExecCommand(): { exec: string[] | undefined; filteredArgv: string[] } {
  const argv = process.argv;
  const execIdx = argv.findIndex(a => a === "--exec" || a === "-x");
  if (execIdx === -1) {
    return { exec: undefined, filteredArgv: argv };
  }
  const execArgs = argv.slice(execIdx + 1);
  const filteredArgv = argv.slice(0, execIdx);
  return { exec: execArgs.length > 0 ? execArgs : undefined, filteredArgv };
}

const { exec: extractedExec, filteredArgv } = extractExecCommand();
process.argv = filteredArgv;
import { clone } from "./commands/clone";
import { add } from "./commands/add";
import { list } from "./commands/list";
import { rm } from "./commands/rm";
import { init } from "./commands/init";
import { cd } from "./commands/cd";
import { shell } from "./commands/shell";

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
  },
  run({ args }) {
    return add(args.name, { from: args.from });
  },
});

const rmCmd = defineCommand({
  meta: {
    name: "rm",
    description: "Remove worktree",
  },
  args: {
    name: {
      type: "positional",
      description: "Worktree name",
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
    return rm(args.name, { force: args.force });
  },
});

const listCmd = defineCommand({
  meta: {
    name: "list",
    description: "List all worktrees",
  },
  run() {
    return list();
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
    open: {
      type: "boolean",
      alias: "o",
      description: "Open in file manager",
      default: false,
    },
    edit: {
      type: "boolean",
      alias: "e",
      description: "Open in IDE (configurable via git config gwt.ide)",
      default: false,
    },
    exec: {
      type: "boolean",
      alias: "x",
      description: "Execute command in worktree (-x cmd args...)",
      default: false,
    },
  },
  run({ args }) {
    const options = [args.open, args.edit, !!extractedExec].filter(Boolean);
    if (options.length > 1) {
      console.error("Error: --open, --edit, and --exec are mutually exclusive");
      process.exit(1);
    }
    return cd(args.name, { open: args.open, edit: args.edit, exec: extractedExec });
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

const main = defineCommand({
  meta: {
    name: "gwt",
    version: "0.1.0",
    description: "Git Worktree Manager",
  },
  subCommands: {
    clone: cloneCmd,
    init: initCmd,
    add: addCmd,
    rm: rmCmd,
    list: listCmd,
    cd: cdCmd,
    shell: shellCmd,
  },
});

runMain(main);
