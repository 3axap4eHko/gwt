import { describe, test, expect, vi, beforeEach } from "vitest";
import { list } from "../commands/list";

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  parseWorktreeList: vi.fn(),
  formatAge: vi.fn(),
}));

import { checkGwtSetup, findGwtRoot, parseWorktreeList, formatAge } from "../core/repo";

const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockParseWorktreeList = vi.mocked(parseWorktreeList);
const mockFormatAge = vi.mocked(formatAge);

describe("list", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFormatAge.mockReturnValue("");
    (globalThis as any).Bun = {
      file: vi.fn(() => ({
        stat: () => Promise.resolve({ mtime: { getTime: () => 0 } }),
      })),
    };
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(list()).rejects.toThrow("Error: Not in gwt repo");
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

    await expect(list()).rejects.toThrow("Error: Failed to list worktrees");
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
      { path: "/project/master", name: "master", commit: "abc1234", branch: "master", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def5678", branch: "feature-x", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("master   abc1234  master");
    expect(consoleSpy).toHaveBeenCalledWith("feature  def5678  feature-x");
  });

  test("shows detached for null branch", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/detached", name: "detached", commit: "abc1234", branch: null, isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("detached  abc1234  (detached)");
  });

  test("handles missing commit", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/master", name: "master", branch: "master", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("master    master");
  });

  test("shows dirty flag when worktree has changes", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/feature", name: "feature", commit: "abc1234", branch: "feature", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => " M src/index.ts" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("feature  abc1234  feature  [dirty]");
  });

  test("shows locked flag", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/feature", name: "feature", commit: "abc1234", branch: "feature", isBare: false, locked: "" },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("feature  abc1234  feature  [locked]");
  });

  test("shows both dirty and locked flags", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/feature", name: "feature", commit: "abc1234", branch: "feature", isBare: false, locked: "wip" },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => " M file.ts" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("feature  abc1234  feature  [dirty, locked]");
  });

  test("shows age when mtime available", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/feature", name: "feature", commit: "abc1234", branch: "feature", isBare: false },
    ]);
    mockFormatAge.mockReturnValue("3h ago");

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 3 * 3600000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("feature  abc1234  feature  3h ago");
  });

  test("outputs JSON with --json flag", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/master", name: "master", commit: "abc1234567890", branch: "master", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def5678901234", branch: "feature", isBare: false, locked: "wip" },
    ]);
    mockFormatAge.mockReturnValue("2d ago");

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 2 * 86400000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list({ json: true });

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      name: "master",
      path: "/project/master",
      commit: "abc1234567890",
      branch: "master",
      dirty: false,
      locked: false,
      age: "2d ago",
    });
    expect(parsed[1]).toEqual({
      name: "feature",
      path: "/project/feature",
      commit: "def5678901234",
      branch: "feature",
      dirty: false,
      locked: true,
      lockReason: "wip",
      age: "2d ago",
    });
  });

  test("outputs only names with --names flag", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/.bare", name: ".bare", branch: null, isBare: true },
      { path: "/project/master", name: "master", commit: "abc1234", branch: "master", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def5678", branch: "feature", isBare: false },
    ]);

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

    await list({ names: true });

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith("master");
    expect(consoleSpy).toHaveBeenCalledWith("feature");
  });

  test("handles stat errors gracefully", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/master", name: "master", commit: "abc1234", branch: "master", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.reject(new Error("stat error")),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation(() => ({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "" },
          }),
      }),
    } as any));

    await list();

    expect(consoleSpy).toHaveBeenCalledWith("master  abc1234  master");
  });
});
