import { describe, test, expect, vi, beforeEach } from "vitest";
import { sync } from "../commands/sync";

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  getWorktrees: vi.fn(),
  formatAge: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../commands/cd", () => ({
  resolveWorktree: vi.fn(),
  selectWorktree: vi.fn(),
}));

import { checkGwtSetup, findGwtRoot, getWorktrees } from "../core/repo";
import { resolveWorktree, selectWorktree } from "../commands/cd";

const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockGetWorktrees = vi.mocked(getWorktrees);
const mockResolveWorktree = vi.mocked(resolveWorktree);
const mockSelectWorktree = vi.mocked(selectWorktree);

describe("sync", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(sync("master")).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits with error when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([]);

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

    await expect(sync("master", { noFetch: true })).rejects.toThrow("No worktrees found");
  });

  test("fetches remotes by default", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/master", name: "master", branch: "master", mtime: 0,
    });

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

    await sync("master");

    expect(consoleSpy).toHaveBeenCalledWith("Fetching remotes...");
  });

  test("skips fetch with noFetch option", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/master", name: "master", branch: "master", mtime: 0,
    });

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

    await sync("master", { noFetch: true });

    expect(consoleSpy).not.toHaveBeenCalledWith("Fetching remotes...");
  });

  test("warns on fetch failure but continues", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/master", name: "master", branch: "master", mtime: 0,
    });

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
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

    await sync("master");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Warning: Failed to fetch remotes");
    expect(consoleSpy).toHaveBeenCalledWith("Done! 'master' is up to date");
  });

  test("pulls with rebase in named worktree", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/feature", name: "feature", branch: "feature", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/feature", name: "feature", branch: "feature", mtime: 0,
    });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "Already up to date." },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await sync("feature", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("Syncing 'feature'...");
    expect(consoleSpy).toHaveBeenCalledWith("Already up to date.");
    expect(consoleSpy).toHaveBeenCalledWith("Done! 'feature' is up to date");
  });

  test("throws on pull failure", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/master", name: "master", branch: "master", mtime: 0,
    });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 1,
            stdout: { toString: () => "" },
            stderr: { toString: () => "fatal: not possible to fast-forward" },
          }),
      }),
    } as any);

    await expect(sync("master", { noFetch: true })).rejects.toThrow("Error: Failed to sync");
  });

  test("uses interactive selector when no name provided", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    const worktrees = [
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
      { path: "/project/feature", name: "feature", branch: "feature", mtime: 0 },
    ];
    mockGetWorktrees.mockResolvedValue(worktrees);
    mockSelectWorktree.mockResolvedValue(worktrees[1]);

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

    await sync(undefined, { noFetch: true });

    expect(mockSelectWorktree).toHaveBeenCalledWith(worktrees);
    expect(consoleSpy).toHaveBeenCalledWith("Done! 'feature' is up to date");
  });

  test("shows pull output when present", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/master", name: "master", branch: "master", mtime: 0,
    });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "Updating abc123..def456\nFast-forward\n src/index.ts | 5 ++-" },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await sync("master", { noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Updating abc123..def456\nFast-forward\n src/index.ts | 5 ++-"
    );
  });
});
