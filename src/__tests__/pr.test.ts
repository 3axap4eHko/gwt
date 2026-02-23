import { describe, test, expect, vi, beforeEach } from "vitest";
import { pr } from "../commands/pr";

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  getWorktrees: vi.fn(),
  formatAge: vi.fn(),
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

describe("pr", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(pr()).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits with error when gh not installed", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 1 }),
      }),
    } as any);

    await expect(pr()).rejects.toThrow("'gh' CLI not found");
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
          }),
      }),
    } as any);

    await expect(pr()).rejects.toThrow("No worktrees found");
  });

  test("exits with error for detached HEAD", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/detached", name: "detached", branch: null, mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/detached", name: "detached", branch: null, mtime: 0,
    });

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

    await expect(pr(undefined, "detached")).rejects.toThrow("detached HEAD");
  });

  test("opens existing PR in browser", async () => {
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
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await pr(undefined, "feature");
  });

  test("creates PR with --web flag", async () => {
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
            stdout: { toString: () => "" },
            stderr: { toString: () => "" },
          }),
      }),
    } as any);

    await pr("create", "feature");

    expect(consoleSpy).toHaveBeenCalledWith("Creating PR for 'feature'...");
  });

  test("shows helpful message when no PR found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/feature", name: "feature", branch: "feature", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/feature", name: "feature", branch: "feature", mtime: 0,
    });

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0 });
          }
          return Promise.resolve({
            exitCode: 1,
            stderr: { toString: () => "no pull requests found for branch \"feature\"" },
          });
        },
      }),
    } as any));

    await expect(pr(undefined, "feature")).rejects.toThrow(
      "No PR found for branch 'feature'. Use 'gwt pr create' to create one."
    );
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

    await pr();

    expect(mockSelectWorktree).toHaveBeenCalledWith(worktrees);
  });

  test("throws on create failure", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/feature", name: "feature", branch: "feature", mtime: 0 },
    ]);
    mockResolveWorktree.mockReturnValue({
      path: "/project/feature", name: "feature", branch: "feature", mtime: 0,
    });

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0 });
          }
          return Promise.resolve({
            exitCode: 1,
            stderr: { toString: () => "authentication required" },
          });
        },
      }),
    } as any));

    await expect(pr("create", "feature")).rejects.toThrow("Error: Failed to create PR");
  });
});
