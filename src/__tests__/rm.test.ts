import { describe, test, expect, vi, beforeEach } from "vitest";
import { rm } from "../commands/rm";

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

describe("rm", () => {
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

    await expect(rm("../invalid")).rejects.toThrow("Error: Invalid worktree name");
  });

  test("exits with error when not in gwt repo", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(rm("feature")).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits with error when worktree not found", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Worktree 'feature' not found");
  });

  test("blocks removal of default branch without force", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue("master");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any);

    await expect(rm("master")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot remove 'master' due to safety checks"));
  });

  test("blocks removal with uncommitted changes", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => " M file.txt" },
          }),
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Uncommitted changes in worktree"));
  });

  test("blocks removal when not pushed to remote", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Branch 'feature' not pushed to remote"));
  });

  test("blocks removal with unpushed commits", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "origin"
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "origin" } });
          // 3: fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> 2
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "2" } });
          // 5: rev-list behind -> 0
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("2 unpushed commits"));
  });

  test("blocks removal when behind remote", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "origin"
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "origin" } });
          // 3: fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> 0
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // 5: rev-list behind -> 3
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "3" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("3 commits behind remote"));
  });

  test("blocks removal when rev-list commands fail", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "origin"
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "origin" } });
          // 3: fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> fail
          if (callCount === 4) return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          // 5: rev-list behind -> fail
          return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to check unpushed commits"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to check commits behind remote"));
  });

  test("removes worktree successfully", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

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

    await rm("feature", { force: true });

    expect(consoleSpy).toHaveBeenCalledWith("Removing worktree 'feature'...");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'feature' removed");
  });

  test("deletes branch after removing worktree", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue("master");

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

    await rm("feature", { force: true });

    expect(consoleSpy).toHaveBeenCalledWith("  Branch 'feature' also deleted");
  });

  test("does not delete default branch", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue("master");

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

    await rm("master", { force: true });

    expect(consoleSpy).not.toHaveBeenCalledWith("  Branch 'master' also deleted");
  });

  test("retries with force when initial remove fails", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1, stderr: { toString: () => "error" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await rm("feature", { force: true });

    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'feature' removed");
  });

  test("exits when force remove also fails", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 1,
            stderr: { toString: () => "fatal error" },
          }),
      }),
    } as any);

    await expect(rm("feature", { force: true })).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error: Failed to remove worktree 'feature'"));
  });

  test("exits when remove fails without force", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "origin"
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "origin" } });
          // 3: fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> 0
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // 5: rev-list behind -> 0
          if (callCount === 5) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // 6: git worktree remove (fails)
          return Promise.resolve({ exitCode: 1, stderr: { toString: () => "error" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Use --force to override"));
  });

  test("handles singular commit message", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "origin"
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "origin" } });
          // 3: fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> 1
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "1" } });
          // 5: rev-list behind -> 1
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "1" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("1 unpushed commit"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("1 commit behind remote"));
  });

  test("uses configured upstream remote over origin", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: for-each-ref upstream -> "upstream/feature" (not origin)
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "upstream/feature" } });
          // 3: fetch --all
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // 4: rev-list ahead -> 0
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // 5: rev-list behind -> 0
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
        },
      }),
    } as any);

    await rm("feature", { force: false });

    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'feature' removed");
  });

  test("resolves slash-named remote when upstream is missing", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // 1: status --porcelain (clean)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 2: upstream not configured
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // 3: scan refs/remotes for matching branch
          if (callCount === 3) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "team/core/feature" } });
          // 4: validate remote exists
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "git@example.com:x/y.git" } });
          // 5: fetch --all
          if (callCount === 5) return Promise.resolve({ exitCode: 0 });
          // 6: rev-list ahead -> 0
          if (callCount === 6) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // 7: rev-list behind -> 0
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
        },
      }),
    } as any);

    await rm("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'feature' removed");
  });

  test("local-only branch reports not pushed to remote", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any);

    await expect(rm("local-only")).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Branch 'local-only' not pushed to remote"));
  });

  test("removes multiple worktrees", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue(null);

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

    await rm(["a", "b", "c"], { force: true });

    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'a' removed");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'b' removed");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'c' removed");
  });

  test("continues removing after individual failure", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockImplementation((p: any) => !String(p).includes("missing"));
    mockGetDefaultBranch.mockReturnValue(null);

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

    await expect(rm(["good", "missing", "also-good"], { force: true })).rejects.toThrow("Failed to remove 1 worktree");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'good' removed");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Worktree 'missing' not found");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'also-good' removed");
  });

  test("reports count when multiple removals fail", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    await expect(rm(["a", "b"], { force: true })).rejects.toThrow("Failed to remove 2 worktrees");
  });
});
