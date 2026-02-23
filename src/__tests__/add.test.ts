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
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("exits with error for invalid worktree name", async () => {
    mockIsValidWorktreeName.mockReturnValue(false);

    await expect(add("../invalid")).rejects.toThrow("Error: Invalid worktree name");
  });

  test("exits with error when not in gwt repo", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(add("feature")).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits with error when directory already exists", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);

    await expect(add("feature")).rejects.toThrow("Error: Directory 'feature' already exists");
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

    await add("feature", { noFetch: true });

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
            // findRemoteBranch: git for-each-ref returns origin/feature
            if (callCount === 1) {
              return Promise.resolve({
                exitCode: 0,
                stdout: { toString: () => "origin/feature" },
              });
            }
            // branchExistsLocally: not found locally
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

    await add("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' tracking remote branch...");
  });

  test("prefers origin when branch exists on multiple remotes", async () => {
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
                stdout: { toString: () => "upstream/feature\norigin/feature" },
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

    await add("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' tracking remote branch...");
  });

  test("falls back to non-origin remote", async () => {
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
                stdout: { toString: () => "upstream/feature" },
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

    await add("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' tracking remote branch...");
  });

  test("tracks remote branch when remote name contains slash", async () => {
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
            // findRemoteBranch: refs/remotes scan
            if (callCount === 1) {
              return Promise.resolve({
                exitCode: 0,
                stdout: { toString: () => "team/core/feature" },
              });
            }
            // branchExistsLocally: not found locally
            if (callCount === 2) {
              return Promise.resolve({ exitCode: 1 });
            }
            // validate remote exists
            if (callCount === 3) {
              return Promise.resolve({ exitCode: 0 });
            }
            // git worktree add
            return Promise.resolve({
              exitCode: 0,
              stdout: { toString: () => "" },
              stderr: { toString: () => "" },
            });
          },
        }),
      } as any;
    });

    await add("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' tracking remote branch...");
  });

  test("creates new branch from default", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);
    mockGetDefaultBranch.mockReturnValue("master");

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
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Creating worktree 'feature' as new branch from 'master'...");
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
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature", { from: "develop", noFetch: true });

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
          if (callCount <= 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature", { noFetch: true });

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

    await expect(add("feature", { noFetch: true })).rejects.toThrow("Error: Failed to create worktree");
  });

  test("fetches all remotes by default", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await add("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Fetching remotes...");
  });

  test("skips fetch with noFetch option", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await add("feature", { noFetch: true });

    expect(consoleSpy).not.toHaveBeenCalledWith("Fetching remotes...");
  });

  test("warns on fetch failure but continues", async () => {
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
          // Call 1: fetch fails
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1, stderr: { toString: () => "network error" } });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          });
        },
      }),
    } as any));

    await add("feature");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Warning: Failed to fetch remotes");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree created at feature/");
  });
});
