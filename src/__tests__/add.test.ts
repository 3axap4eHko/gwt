import { describe, test, expect, vi, beforeEach } from "vitest";
import { add } from "../commands/add";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  getDefaultBranch: vi.fn(),
}));

vi.mock("../core/validation", () => ({
  isValidWorktreeName: vi.fn(),
}));

import { existsSync } from "fs";
import { checkGwtSetup, findGwtRoot, getDefaultBranch } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

const mockExistsSync = vi.mocked(existsSync);
const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockGetDefaultBranch = vi.mocked(getDefaultBranch);
const mockIsValidWorktreeName = vi.mocked(isValidWorktreeName);

describe("add", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockChdir: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("exits with error for invalid worktree name", async () => {
    mockIsValidWorktreeName.mockReturnValue(false);

    await expect(add("../invalid")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Invalid worktree name");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test("exits with error when not in gwt repo", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(add("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Not in gwt repo");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test("exits with error when directory already exists", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);

    await expect(add("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Directory 'feature' already exists");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test("creates worktree from local branch", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let cmdCalled: string[] = [];
    vi.mocked($).mockImplementation((strings: any, ...values: any[]) => {
      if (Array.isArray(strings)) {
        cmdCalled = strings[0] ? [strings[0]] : values[0];
      } else {
        cmdCalled = strings;
      }
      return {
        quiet: () => ({
          nothrow: () =>
            Promise.resolve({
              exitCode: cmdCalled.includes("show-ref") ? 0 : 0,
              stdout: { toString: () => "" },
              stderr: { toString: () => "" },
            }),
        }),
      } as any;
    });

    await add("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' from existing branch...");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree created at feature/");
  });

  test("creates worktree tracking remote branch", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => {
      callCount++;
      return {
        quiet: () => ({
          nothrow: () => {
            if (callCount === 1) {
              return Promise.resolve({
                exitCode: 0,
                stdout: { toString: () => "abc123 refs/heads/feature" },
              });
            }
            if (callCount === 2) {
              return Promise.resolve({ exitCode: 1 });
            }
            return Promise.resolve({
              exitCode: 0,
              stdout: { toString: () => "" },
              stderr: { toString: () => "" },
            });
          },
        }),
      } as any;
    });

    await add("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' tracking remote branch...");
  });

  test("creates new branch from default", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);
    mockGetDefaultBranch.mockReturnValue("main");

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // First two calls: branch existence checks (both return not found)
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Third call: worktree add
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' as new branch from 'main'...");
  });

  test("uses from option for source branch", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // First two calls: branch existence checks (both return not found)
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Third call: worktree add
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature", { from: "develop" });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' as new branch from 'develop'...");
  });

  test("falls back to master when no default branch", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // First two calls: branch existence checks (both return not found)
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Third call: worktree add
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' as new branch from 'master'...");
  });

  test("exits with error when git command fails", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          return Promise.resolve({
            exitCode: 1,
            stderr: { toString: () => "fatal: error" },
          });
        },
      }),
    } as any));

    await expect(add("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Failed to create worktree");
  });
});
