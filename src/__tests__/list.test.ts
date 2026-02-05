import { describe, test, expect, vi, beforeEach } from "vitest";
import { list } from "../commands/list";

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  parseWorktreeList: vi.fn(),
}));

import { checkGwtSetup, findGwtRoot, parseWorktreeList } from "../core/repo";

const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockParseWorktreeList = vi.mocked(parseWorktreeList);

describe("list", () => {
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

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(list()).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Not in gwt repo");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test("exits with error when git command fails", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 1 }),
      }),
    } as any);

    await expect(list()).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Failed to list worktrees");
  });

  test("shows message when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/.bare", name: ".bare", branch: null, isBare: true },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "worktree /project/.bare\nbare" },
          }),
      }),
    } as any);

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("No worktrees found");
  });

  test("lists worktrees with formatting", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/.bare", name: ".bare", branch: null, isBare: true },
      { path: "/project/main", name: "main", commit: "abc1234", branch: "main", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def5678", branch: "feature-x", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("main     abc1234  main");
    expect(consoleSpy).toHaveBeenCalledWith("feature  def5678  feature-x");
  });

  test("shows detached for null branch", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/detached", name: "detached", commit: "abc1234", branch: null, isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("detached  abc1234  (detached)");
  });

  test("handles missing commit", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("main    main");
  });
});
