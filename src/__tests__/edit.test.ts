import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { edit } from "../commands/edit";

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  getWorktrees: vi.fn(),
  formatAge: vi.fn(() => "1h ago"),
}));

import { select, isCancel } from "@clack/prompts";
import { checkGwtSetup, findGwtRoot, getWorktrees } from "../core/repo";

const mockSelect = vi.mocked(select);
const mockIsCancel = vi.mocked(isCancel);
const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockGetWorktrees = vi.mocked(getWorktrees);

describe("edit", () => {
  let mockChdir: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    originalEnv = { ...process.env };
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    mockChdir.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.env = originalEnv;
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(edit()).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([]);

    await expect(edit()).rejects.toThrow("No worktrees found");
  });

  test("opens IDE and outputs path", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code\n" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("uses interactive selector when no name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/master", name: "master", branch: "master", mtime: Date.now() });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "code\n" } }),
      }),
    } as any);

    await edit();

    expect(mockSelect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("detects IDE from git config", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code\n" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("skips empty git config ide and uses VISUAL", async () => {
    process.env.VISUAL = "nvim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "   \n" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("uses VISUAL env", async () => {
    process.env.VISUAL = "nvim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("uses which candidates", async () => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Call 1: git config gwt.ide (not set)
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Call 2: which zed (found!)
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "/usr/bin/zed" } });
          }
          // Call 3: open zed
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("uses EDITOR env as fallback", async () => {
    delete process.env.VISUAL;
    process.env.EDITOR = "vim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Call 1: git config gwt.ide (not set)
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Calls 2-5: which zed/nvim/cursor/code (all fail)
          if (callCount <= 5) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Call 6: open vim (succeed)
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleSpy).toHaveBeenCalledWith("/project/master");
  });

  test("throws when no IDE found", async () => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(edit("master")).rejects.toThrow(
      "No IDE found. Set one with: git config --global gwt.ide <ide>"
    );
  });

  test("warns when IDE fails to open", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code" } });
          }
          return Promise.resolve({ exitCode: 1 });
        },
      }),
    } as any);

    await edit("master");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Warning: Failed to open code");
  });

  test("--add flag works with code IDE", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/feature", name: "feature", branch: "feature", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    const calls: any[] = [];
    let callCount = 0;
    vi.mocked($).mockImplementation((...args: any[]) => {
      callCount++;
      calls.push(args);
      return {
        quiet: () => ({
          nothrow: () => {
            if (callCount === 1) {
              return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code" } });
            }
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          },
        }),
      } as any;
    });

    await edit("feature", { add: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/feature");
  });

  test("--add flag is ignored for non-vscode IDEs", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/feature", name: "feature", branch: "feature", mtime: Date.now() },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockImplementation(() => {
      callCount++;
      return {
        quiet: () => ({
          nothrow: () => {
            if (callCount === 1) {
              return Promise.resolve({ exitCode: 0, stdout: { toString: () => "nvim" } });
            }
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          },
        }),
      } as any;
    });

    await edit("feature", { add: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/feature");
  });
});
