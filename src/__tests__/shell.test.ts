import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { shell } from "../commands/shell";

describe("shell", () => {
  const originalEnv = process.env.SHELL;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env.SHELL = originalEnv;
  });

  test("outputs bash script with wrapper and completions", () => {
    shell("bash");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("gwt()");
    expect(output).toContain('"cd" || "$1" == "edit"');
    expect(output).toContain("_gwt_completions");
    expect(output).toContain("complete -F _gwt_completions gwt");
  });

  test("outputs zsh script with compdef", () => {
    shell("zsh");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("gwt()");
    expect(output).toContain("_gwt()");
    expect(output).toContain("compdef _gwt gwt");
    expect(output).toContain("_describe");
  });

  test("outputs fish script with complete commands", () => {
    shell("fish");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("function gwt");
    expect(output).toContain('"cd" -o "$argv[1]" = "edit"');
    expect(output).toContain("complete -c gwt -n '__fish_use_subcommand'");
    expect(output).toContain("__fish_seen_subcommand_from");
  });

  test("outputs bash script for unknown shell type", () => {
    shell("unknown");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("gwt()");
    expect(output).toContain("_gwt_completions");
  });

  test("bash completions include subcommands", () => {
    shell("bash");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("clone init add rm list");
    expect(output).toContain("sync pr mr shell");
  });

  test("bash completions complete worktree names for relevant commands", () => {
    shell("bash");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("gwt list --names");
    expect(output).toContain("cd|edit|rm|sync|pr|mr|lock|unlock|move|run");
  });

  test("fish completions list all subcommands", () => {
    shell("fish");
    const output = consoleSpy.mock.calls[0][0];
    for (const cmd of ["clone", "init", "add", "rm", "list", "cd", "edit", "run", "sync", "pr", "shell"]) {
      expect(output).toContain(`-a ${cmd}`);
    }
  });

  test("detects fish from SHELL env", () => {
    process.env.SHELL = "/usr/bin/fish";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("function gwt"));
  });

  test("detects zsh from SHELL env", () => {
    process.env.SHELL = "/bin/zsh";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("compdef _gwt gwt"));
  });

  test("detects bash from SHELL env", () => {
    process.env.SHELL = "/bin/bash";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("_gwt_completions"));
  });

  test("defaults to bash when SHELL is empty", () => {
    process.env.SHELL = "";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
  });

  test("defaults to bash when SHELL is undefined", () => {
    delete process.env.SHELL;
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
  });
});
