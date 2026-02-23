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

    await expect(rm("feature")).rejects.toThrow("Error: Worktree 'feature' not found");
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

    await expect(rm("master")).rejects.toThrow("Cannot remove worktree due to safety checks");
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

    await expect(rm("feature")).rejects.toThrow("Uncommitted changes in worktree");
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

    await expect(rm("feature")).rejects.toThrow("Branch 'feature' not pushed to remote");
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

    await expect(rm("feature")).rejects.toThrow("2 unpushed commits");
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

    await expect(rm("feature")).rejects.toThrow("3 commits behind remote");
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

    const error = await rm("feature").catch((e: Error) => e);
    expect(error.message).toContain("Failed to check unpushed commits");
    expect(error.message).toContain("Failed to check commits behind remote");
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

    await expect(rm("feature", { force: true })).rejects.toThrow("Error: Failed to remove worktree");
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

    await expect(rm("feature")).rejects.toThrow("Use --force to override");
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

    const error = await rm("feature").catch((e: Error) => e);
    expect(error.message).toContain("1 unpushed commit");
    expect(error.message).toContain("1 commit behind remote");
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

    await expect(rm("local-only")).rejects.toThrow("Branch 'local-only' not pushed to remote");
  });
});
