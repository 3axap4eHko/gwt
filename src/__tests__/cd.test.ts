import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cd } from "../commands/cd";

vi.mock("fs", () => ({
  openSync: vi.fn(() => 3),
  closeSync: vi.fn(),
}));

vi.mock("tty", () => ({
  isatty: vi.fn(() => true),
}));

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
  parseWorktreeList: vi.fn(),
}));

import { openSync, closeSync } from "fs";
import { isatty } from "tty";
import { select, isCancel } from "@clack/prompts";
import { checkGwtSetup, findGwtRoot, parseWorktreeList } from "../core/repo";

const mockOpenSync = vi.mocked(openSync);
const mockCloseSync = vi.mocked(closeSync);
const mockIsatty = vi.mocked(isatty);
const mockSelect = vi.mocked(select);
const mockIsCancel = vi.mocked(isCancel);
const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockParseWorktreeList = vi.mocked(parseWorktreeList);

describe("cd", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockChdir: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalPlatform: PropertyDescriptor | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    originalEnv = { ...process.env };

    // Reset isCancel to return false by default
    mockIsCancel.mockReturnValue(false);

    // Mock Bun.file and Bun.spawn
    (globalThis as any).Bun = {
      file: vi.fn(() => ({
        stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 3600000 } }),
      })),
      spawn: vi.fn(() => ({
        kill: vi.fn(),
        exited: Promise.resolve(0),
      })),
    };
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    process.env = originalEnv;
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(cd()).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Not in gwt repo");
  });

  test("exits when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(cd()).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("No worktrees found");
  });

  test("exits when git worktree list fails", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 1 }),
      }),
    } as any);

    await expect(cd()).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Failed to list worktrees");
  });

  test("outputs path when worktree found by name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main");

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("exits when worktree not found by name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(cd("feature")).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Worktree 'feature' not found");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Available: main");
  });

  test("shows interactive selector when no name provided", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: Date.now() });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd();

    expect(mockSelect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("exits when selector cancelled", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);
    mockSelect.mockResolvedValue(Symbol("cancel"));
    mockIsCancel.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(cd()).rejects.toThrow("process.exit");
  });

  test("opens in file manager on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main", { open: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in file manager on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main", { open: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in file manager on WSL", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main", { open: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in file manager on Linux", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env.WSL_DISTRO_NAME;
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main", { open: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in IDE from git config", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code\n" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("skips empty git config ide and uses VISUAL", async () => {
    process.env.VISUAL = "nvim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          // git config gwt.ide returns success but empty string
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "   \n" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in IDE from VISUAL env", async () => {
    process.env.VISUAL = "nvim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in IDE from which candidates", async () => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Call 1: git worktree list
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          // Call 2: git config gwt.ide (not set)
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Call 3: which zed (found!)
          if (callCount === 3) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "/usr/bin/zed" } });
          }
          // Call 4: open zed
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("opens in IDE from EDITOR env", async () => {
    delete process.env.VISUAL;
    process.env.EDITOR = "vim";
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Call 1: git worktree list
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          // Call 2: git config gwt.ide (not set)
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Calls 3-6: which zed/nvim/cursor/code (all fail)
          if (callCount <= 6) {
            return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
          }
          // Call 7: open vim (succeed)
          return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("exits when no IDE found", async () => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Call 1: git worktree list
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          // All other calls fail (git config, which commands)
          return Promise.resolve({ exitCode: 1, stdout: { toString: () => "" } });
        },
      }),
    } as any);

    await expect(cd("main", { edit: true })).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "No IDE found. Set one with: git config --global gwt.ide <ide>"
    );
  });

  test("warns when IDE fails to open", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          }
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 0, stdout: { toString: () => "code" } });
          }
          return Promise.resolve({ exitCode: 1 });
        },
      }),
    } as any);

    await cd("main", { edit: true });

    expect(consoleErrorSpy).toHaveBeenCalledWith("Warning: Failed to open code");
  });

  test("executes command in worktree", async () => {
    mockIsatty.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main", { exec: ["echo", "hello"] });

    expect((globalThis as any).Bun.spawn).toHaveBeenCalledWith(
      ["echo", "hello"],
      expect.objectContaining({ cwd: "/project/main" })
    );
    expect(mockCloseSync).toHaveBeenCalled();
  });

  test("exits when exec requires TTY but none available", async () => {
    mockIsatty.mockReturnValue(false);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(cd("main", { exec: ["echo", "hello"] })).rejects.toThrow("process.exit");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: --exec requires an interactive terminal");
  });

  test("exits with command exit code on failure", async () => {
    mockIsatty.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.spawn = vi.fn(() => ({
      kill: vi.fn(),
      exited: Promise.resolve(1),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await expect(cd("main", { exec: ["false"] })).rejects.toThrow("process.exit");
  });

  test("filters out bare worktrees", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/.bare", name: ".bare", branch: null, isBare: true },
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main");

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("handles stat error gracefully", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.reject(new Error("stat error")),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    await cd("main");

    expect(consoleSpy).toHaveBeenCalledWith("/project/main");
  });

  test("formats age correctly for days", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 2 * 86400000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: Date.now() - 2 * 86400000 });

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

  test("formats age correctly for hours", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 2 * 3600000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: Date.now() - 2 * 3600000 });

    await cd();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("2h ago"),
          }),
        ]),
      })
    );
  });

  test("formats age correctly for minutes", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 5 * 60000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: Date.now() - 5 * 60000 });

    await cd();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("5m ago"),
          }),
        ]),
      })
    );
  });

  test("formats age as just now for recent changes", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: { getTime: () => Date.now() - 1000 } }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: Date.now() - 1000 });

    await cd();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            label: expect.stringContaining("just now"),
          }),
        ]),
      })
    );
  });

  test("shows detached for null branch in selector", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/detached", name: "detached", commit: "abc123", branch: null, isBare: false },
    ]);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

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

  test("handles empty mtime", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    (globalThis as any).Bun.file = vi.fn(() => ({
      stat: () => Promise.resolve({ mtime: null }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/main", name: "main", branch: "main", mtime: 0 });

    await cd();

    expect(mockSelect).toHaveBeenCalled();
  });

  test("sorts worktrees by mtime descending", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/old", name: "old", branch: "old", isBare: false },
      { path: "/project/new", name: "new", branch: "new", isBare: false },
    ]);

    const now = Date.now();
    (globalThis as any).Bun.file = vi.fn((path: string) => ({
      stat: () => Promise.resolve({
        mtime: { getTime: () => path.includes("new") ? now : now - 86400000 },
      }),
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    mockSelect.mockResolvedValue({ path: "/project/new", name: "new", branch: "new", mtime: now });

    await cd();

    const selectCall = mockSelect.mock.calls[0][0];
    expect(selectCall.options[0].value.name).toBe("new");
    expect(selectCall.options[1].value.name).toBe("old");
  });

  test("forwards signals to spawned process", async () => {
    mockIsatty.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockParseWorktreeList.mockReturnValue([
      { path: "/project/main", name: "main", branch: "main", isBare: false },
    ]);

    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
    });

    const mockKill = vi.fn();
    (globalThis as any).Bun.spawn = vi.fn(() => ({
      kill: mockKill,
      exited: exitPromise,
    }));

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } }),
      }),
    } as any);

    const cdPromise = cd("main", { exec: ["sleep", "10"] });

    // Emit signal while process is running
    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGINT");

    expect(mockKill).toHaveBeenCalledWith("SIGINT");

    exitResolve!(0);
    await cdPromise;
  });
});
