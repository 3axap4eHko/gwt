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

  // --- filter tests ---

  async function setupFilterTest(worktrees: any[], responses: Record<string, any>) {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue(worktrees);
    mockFormatAge.mockReturnValue("");

    const { $ } = await import("bun");
    vi.mocked($).mockImplementation((strings: any, ...values: any[]) => {
      const cmd = strings.reduce((acc: string, s: string, i: number) => acc + s + (values[i] ?? ""), "");
      for (const [pattern, response] of Object.entries(responses)) {
        if (cmd.includes(pattern)) {
          return {
            quiet: () => ({
              nothrow: () => Promise.resolve(
                typeof response === "function" ? response(cmd) : response,
              ),
            }),
          } as any;
        }
      }
      return {
        quiet: () => ({
          nothrow: () => Promise.resolve({ exitCode: 0, stdout: { toString: () => "" }, stderr: { toString: () => "" } }),
        }),
      } as any;
    });
  }

  test("--synced outputs only worktrees in sync with remote", async () => {
    await setupFilterTest([
      { path: "/project/.bare", name: ".bare", branch: null, isBare: true },
      { path: "/project/master", name: "master", commit: "abc1234", branch: "master", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def5678", branch: "feature", isBare: false },
      { path: "/project/wip", name: "wip", commit: "ghi9012", branch: "wip", isBare: false },
    ], {
      "fetch --all": { exitCode: 0 },
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "refs/heads/feature": { exitCode: 0, stdout: { toString: () => "origin/feature" } },
      "refs/heads/wip": { exitCode: 0, stdout: { toString: () => "" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    await list({ synced: true, names: true, noFetch: true });

    expect(consoleSpy).toHaveBeenCalledWith("master");
    expect(consoleSpy).toHaveBeenCalledWith("feature");
    expect(consoleSpy).not.toHaveBeenCalledWith("wip");
  });

  test("--ahead outputs only worktrees ahead of remote", async () => {
    await setupFilterTest([
      { path: "/project/master", name: "master", commit: "abc", branch: "master", isBare: false },
      { path: "/project/feature", name: "feature", commit: "def", branch: "feature", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "refs/heads/feature": { exitCode: 0, stdout: { toString: () => "origin/feature" } },
      "rev-list --count": (cmd: string) => {
        if (cmd.includes("/project/feature") && cmd.includes("origin/feature..HEAD")) {
          return { exitCode: 0, stdout: { toString: () => "3" } };
        }
        return { exitCode: 0, stdout: { toString: () => "0" } };
      },
    });

    await list({ ahead: true, names: true, noFetch: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("feature");
  });

  test("--behind outputs only worktrees behind remote", async () => {
    await setupFilterTest([
      { path: "/project/master", name: "master", commit: "abc", branch: "master", isBare: false },
      { path: "/project/old", name: "old", commit: "def", branch: "old", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "refs/heads/old": { exitCode: 0, stdout: { toString: () => "origin/old" } },
      "rev-list --count": (cmd: string) => {
        if (cmd.includes("/project/old") && cmd.includes("HEAD..origin/old")) {
          return { exitCode: 0, stdout: { toString: () => "2" } };
        }
        return { exitCode: 0, stdout: { toString: () => "0" } };
      },
    });

    await list({ behind: true, names: true, noFetch: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("old");
  });

  test("--no-remote outputs only worktrees without upstream", async () => {
    await setupFilterTest([
      { path: "/project/master", name: "master", commit: "abc", branch: "master", isBare: false },
      { path: "/project/local", name: "local", commit: "def", branch: "local", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "refs/heads/local": { exitCode: 0, stdout: { toString: () => "" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    await list({ noRemote: true, names: true, noFetch: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("local");
  });

  test("--dirty outputs only worktrees with uncommitted changes", async () => {
    await setupFilterTest([
      { path: "/project/clean-wt", name: "clean-wt", commit: "abc", branch: "clean-wt", isBare: false },
      { path: "/project/dirty-wt", name: "dirty-wt", commit: "def", branch: "dirty-wt", isBare: false },
    ], {
      "status --porcelain": (cmd: string) => {
        if (cmd.includes("/project/dirty-wt")) {
          return { exitCode: 0, stdout: { toString: () => " M file.ts" } };
        }
        return { exitCode: 0, stdout: { toString: () => "" } };
      },
    });

    await list({ dirty: true, names: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("dirty-wt");
  });

  test("--clean outputs only worktrees without uncommitted changes", async () => {
    await setupFilterTest([
      { path: "/project/clean-wt", name: "clean-wt", commit: "abc", branch: "clean-wt", isBare: false },
      { path: "/project/dirty-wt", name: "dirty-wt", commit: "def", branch: "dirty-wt", isBare: false },
    ], {
      "status --porcelain": (cmd: string) => {
        if (cmd.includes("/project/dirty-wt")) {
          return { exitCode: 0, stdout: { toString: () => " M file.ts" } };
        }
        return { exitCode: 0, stdout: { toString: () => "" } };
      },
    });

    await list({ clean: true, names: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("clean-wt");
  });

  test("--clean --synced combines filters with AND", async () => {
    await setupFilterTest([
      { path: "/project/a", name: "a", commit: "1", branch: "a", isBare: false },
      { path: "/project/b", name: "b", commit: "2", branch: "b", isBare: false },
      { path: "/project/c", name: "c", commit: "3", branch: "c", isBare: false },
    ], {
      "status --porcelain": (cmd: string) => {
        if (cmd.includes("/project/b")) {
          return { exitCode: 0, stdout: { toString: () => " M file.ts" } };
        }
        return { exitCode: 0, stdout: { toString: () => "" } };
      },
      "refs/heads/a": { exitCode: 0, stdout: { toString: () => "origin/a" } },
      "refs/heads/b": { exitCode: 0, stdout: { toString: () => "origin/b" } },
      "refs/heads/c": { exitCode: 0, stdout: { toString: () => "" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    await list({ clean: true, synced: true, names: true, noFetch: true });

    // a: clean + synced = yes
    // b: dirty + synced = no (dirty fails --clean)
    // c: clean + no-remote = no (no-remote fails --synced)
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith("a");
  });

  test("--synced fetches by default", async () => {
    let fetchCalled = false;
    await setupFilterTest([
      { path: "/project/master", name: "master", commit: "abc", branch: "master", isBare: false },
    ], {
      "fetch --all": (() => { fetchCalled = true; return { exitCode: 0 }; })(),
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    // Need to re-mock to track fetch
    const { $ } = await import("bun");
    const originalImpl = vi.mocked($).getMockImplementation();
    vi.mocked($).mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const cmd = strings.reduce((acc: string, s: string, i: number) => acc + s + (values[i] ?? ""), "");
      if (cmd.includes("fetch --all")) fetchCalled = true;
      return originalImpl!(strings, ...values);
    });

    await list({ synced: true, names: true });

    expect(fetchCalled).toBe(true);
  });

  test("--no-fetch skips fetching", async () => {
    let fetchCalled = false;
    await setupFilterTest([
      { path: "/project/master", name: "master", commit: "abc", branch: "master", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/master": { exitCode: 0, stdout: { toString: () => "origin/master" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    const { $ } = await import("bun");
    const originalImpl = vi.mocked($).getMockImplementation();
    vi.mocked($).mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
      const cmd = strings.reduce((acc: string, s: string, i: number) => acc + s + (values[i] ?? ""), "");
      if (cmd.includes("fetch --all")) fetchCalled = true;
      return originalImpl!(strings, ...values);
    });

    await list({ synced: true, names: true, noFetch: true });

    expect(fetchCalled).toBe(false);
  });

  test("filters show 'No matching worktrees' when nothing matches", async () => {
    await setupFilterTest([
      { path: "/project/feature", name: "feature", commit: "abc", branch: "feature", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => " M file.ts" } },
    });

    await list({ clean: true });

    expect(consoleSpy).toHaveBeenCalledWith("No matching worktrees");
  });

  test("--json includes sync field when sync filters active", async () => {
    await setupFilterTest([
      { path: "/project/feature", name: "feature", commit: "abc1234567890", branch: "feature", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/feature": { exitCode: 0, stdout: { toString: () => "origin/feature" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    await list({ synced: true, json: true, noFetch: true });

    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed[0].sync).toBe("synced");
  });

  test("table output shows sync status flags", async () => {
    await setupFilterTest([
      { path: "/project/feature", name: "feature", commit: "abc1234", branch: "feature", isBare: false },
    ], {
      "status --porcelain": { exitCode: 0, stdout: { toString: () => "" } },
      "refs/heads/feature": { exitCode: 0, stdout: { toString: () => "" } },
      "rev-list --count": { exitCode: 0, stdout: { toString: () => "0" } },
    });

    await list({ noRemote: true });

    expect(consoleSpy).toHaveBeenCalledWith("feature  abc1234  feature  [no-remote]");
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
