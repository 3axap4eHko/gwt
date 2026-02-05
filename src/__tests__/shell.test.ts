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

  test("outputs bash script when shellType is bash", () => {
    shell("bash");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[[ "$1" == "cd" ]]'));
  });

  test("outputs zsh script when shellType is zsh", () => {
    shell("zsh");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
  });

  test("outputs fish script when shellType is fish", () => {
    shell("fish");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("function gwt"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test "$argv[1]" = "cd"'));
  });

  test("outputs bash script for unknown shell type", () => {
    shell("unknown");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
  });

  test("detects fish from SHELL env", () => {
    process.env.SHELL = "/usr/bin/fish";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("function gwt"));
  });

  test("detects zsh from SHELL env", () => {
    process.env.SHELL = "/bin/zsh";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
  });

  test("detects bash from SHELL env", () => {
    process.env.SHELL = "/bin/bash";
    shell();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gwt()"));
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
