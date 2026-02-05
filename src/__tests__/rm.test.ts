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

    await expect(rm("../invalid")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Invalid worktree name");
  });

  test("exits with error when not in gwt repo", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Not in gwt repo");
  });

  test("exits with error when worktree not found", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Worktree 'feature' not found");
  });

  test("blocks removal of default branch without force", async () => {
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(true);
    mockGetDefaultBranch.mockReturnValue("main");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "abc123 refs/heads/main" },
          }),
      }),
    } as any);

    await expect(rm("main")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Cannot remove worktree due to safety checks:\n");
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

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - Uncommitted changes in worktree");
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
          return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - Branch 'feature' not pushed to remote");
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
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "abc123" } });
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "2" } });
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - 2 unpushed commits");
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
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "abc123" } });
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "3" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - 3 commits behind remote");
  });

  test("handles rev-list command failures gracefully", async () => {
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
          // Call 1: git status --porcelain (no changes)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // Call 2: git ls-remote --heads (branch exists on remote)
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "abc123 refs/heads/feature" } });
          // Call 3: git fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // Call 4: rev-list ahead count (fails)
          if (callCount === 4) return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          // Call 5: rev-list behind count (fails)
          if (callCount === 5) return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          // Call 6: git worktree remove
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" }, stderr: { toString: () => "" } });
        },
      }),
    } as any);

    await rm("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Done! Worktree 'feature' removed");
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
    mockGetDefaultBranch.mockReturnValue("main");

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
    mockGetDefaultBranch.mockReturnValue("main");

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

    await rm("main", { force: true });

    expect(consoleSpy).not.toHaveBeenCalledWith("  Branch 'main' also deleted");
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

    await expect(rm("feature", { force: true })).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Failed to remove worktree");
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
          // Call 1: git status --porcelain (no changes)
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // Call 2: git ls-remote --heads (branch exists on remote)
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "abc123 refs/heads/feature" } });
          // Call 3: git fetch
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          // Call 4: rev-list ahead count (0)
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // Call 5: rev-list behind count (0)
          if (callCount === 5) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "0" } });
          // Call 6: git worktree remove (fails)
          return Promise.resolve({ exitCode: 1, stderr: { toString: () => "error" } });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("\nUse --force to override");
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
          if (callCount === 1) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          if (callCount === 2) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "abc123" } });
          if (callCount === 3) return Promise.resolve({ exitCode: 0 });
          if (callCount === 4) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "1" } });
          if (callCount === 5) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "1" } });
          return Promise.resolve({ exitCode: 0 });
        },
      }),
    } as any);

    await expect(rm("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - 1 unpushed commit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("  - 1 commit behind remote");
  });
});
