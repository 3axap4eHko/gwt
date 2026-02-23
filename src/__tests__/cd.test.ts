import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cd, resolveWorktree, selectWorktree } from "../commands/cd";

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  getWorktrees: vi.fn(),
  formatAge: vi.fn((mtime: number) => {
    if (!mtime) return "";
    const diff = Date.now() - mtime;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  }),
}));

import { select, isCancel } from "@clack/prompts";
import { checkGwtSetup, findGwtRoot, getWorktrees } from "../core/repo";

const mockSelect = vi.mocked(select);
const mockIsCancel = vi.mocked(isCancel);
const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockGetWorktrees = vi.mocked(getWorktrees);

describe("cd", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockChdir: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockChdir.mockRestore();
    consoleSpy.mockRestore();
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(cd()).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([]);

    await expect(cd()).rejects.toThrow("No worktrees found");
  });

  test("outputs path when worktree found by name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    await cd("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("exits when worktree not found by name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const error = await cd("feature").catch((e: Error) => e);
    expect(error.message).toContain("Worktree 'feature' not found");
    expect(error.message).toContain("Available: master");
  });

  test("shows interactive selector when no name provided", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/master", name: "master", branch: "master", mtime: Date.now() });

    await cd();

    expect(mockSelect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("exits when selector cancelled", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);
    mockSelect.mockResolvedValue(Symbol("cancel"));
    mockIsCancel.mockReturnValue(true);

    await expect(cd()).rejects.toThrow("process.exit");
  });

  test("shows detached for null branch in selector", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/detached", name: "detached", branch: null, mtime: Date.now() },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/detached", name: "detached", branch: null, mtime: Date.now() });

    await cd();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("(detached)"),
          }),
        ]),
      })
    );
  });

  test("formats age in selector labels", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    const mtime = Date.now() - 2 * 86400000;
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/master", name: "master", branch: "master", mtime });

    await cd();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("2d ago"),
          }),
        ]),
      })
    );
  });
});

describe("resolveWorktree", () => {
  test("returns matching worktree", () => {
    const worktrees = [
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
      { path: "/project/feat", name: "feat", branch: "feat", mtime: 0 },
    ];
    expect(resolveWorktree(worktrees, "feat")).toBe(worktrees[1]);
  });

  test("throws with available names when not found", () => {
    const worktrees = [
      { path: "/project/master", name: "master", branch: "master", mtime: 0 },
    ];
    expect(() => resolveWorktree(worktrees, "nope")).toThrow("Worktree 'nope' not found");
    expect(() => resolveWorktree(worktrees, "nope")).toThrow("Available: master");
  });
});

describe("selectWorktree", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  test("returns selected worktree", async () => {
    const wt = { path: "/project/master", name: "master", branch: "master", mtime: Date.now() };
    mockSelect.mockResolvedValue(wt);

    const result = await selectWorktree([wt]);
    expect(result).toBe(wt);
  });

  test("exits on cancel", async () => {
    mockSelect.mockResolvedValue(Symbol("cancel"));
    mockIsCancel.mockReturnValue(true);

    const wt = { path: "/project/master", name: "master", branch: "master", mtime: Date.now() };
    await expect(selectWorktree([wt])).rejects.toThrow("process.exit");
  });
});
