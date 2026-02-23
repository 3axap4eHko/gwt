import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { run } from "../commands/run";

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

describe("run", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockChdir: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    mockChdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    mockIsCancel.mockReturnValue(false);

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
    mockExit.mockRestore();
    mockChdir.mockRestore();
    consoleSpy.mockRestore();
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  test("throws when no command provided", async () => {
    await expect(run([])).rejects.toThrow("Error: run requires a command");
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });

    await expect(run(["echo", "hello"])).rejects.toThrow("Error: Not in gwt repo");
  });

  test("exits when no worktrees found", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([]);

    await expect(run(["echo", "hello"])).rejects.toThrow("No worktrees found");
  });

  test("executes command in worktree", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    await run(["echo", "hello"], "master");

    expect((globalThis as any).Bun.spawn).toHaveBeenCalledWith(
      ["echo", "hello"],
      expect.objectContaining({
        cwd: "/project/master",
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
    );
  });

  test("does NOT output path", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    await run(["echo", "hello"], "master");

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("uses interactive selector when no worktree name", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);
    mockSelect.mockResolvedValue({ path: "/project/master", name: "master", branch: "master", mtime: Date.now() });

    await run(["echo", "hello"]);

    expect(mockSelect).toHaveBeenCalled();
    expect((globalThis as any).Bun.spawn).toHaveBeenCalledWith(
      ["echo", "hello"],
      expect.objectContaining({ cwd: "/project/master" })
    );
  });

  test("exits with command exit code on failure", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    (globalThis as any).Bun.spawn = vi.fn(() => ({
      kill: vi.fn(),
      exited: Promise.resolve(1),
    }));

    await expect(run(["false"], "master")).rejects.toThrow("process.exit");
  });

  test("forwards signals to spawned process", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
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

    const runPromise = run(["sleep", "10"], "master");

    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGINT");

    expect(mockKill).toHaveBeenCalledWith("SIGINT");

    exitResolve!(0);
    await runPromise;
  });

  test("uses only SIGINT and SIGTERM on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetWorktrees.mockResolvedValue([
      { path: "/project/master", name: "master", branch: "master", mtime: Date.now() },
    ]);

    await run(["echo", "hello"], "master");

    expect((globalThis as any).Bun.spawn).toHaveBeenCalledWith(
      ["echo", "hello"],
      expect.objectContaining({
        cwd: "/project/master",
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
    );
  });
});
