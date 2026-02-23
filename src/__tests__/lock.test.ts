import { describe, test, expect, vi, beforeEach } from "vitest";
import { lock, unlock, move } from "../commands/lock";

vi.mock("../core/repo", () => ({
  checkGwtSetup: vi.fn(),
  findGwtRoot: vi.fn(),
}));

vi.mock("../core/validation", () => ({
  isValidWorktreeName: vi.fn(),
}));

import { checkGwtSetup, findGwtRoot } from "../core/repo";
import { isValidWorktreeName } from "../core/validation";

const mockCheckGwtSetup = vi.mocked(checkGwtSetup);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockIsValidWorktreeName = vi.mocked(isValidWorktreeName);

describe("lock", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
  });

  test("rejects invalid worktree name", async () => {
    mockIsValidWorktreeName.mockReturnValue(false);
    await expect(lock("../bad")).rejects.toThrow("Invalid worktree name");
  });

  test("exits with error when not in gwt repo", async () => {
    mockCheckGwtSetup.mockReturnValue({ ok: false, error: "Not in gwt repo" });
    await expect(lock("feature")).rejects.toThrow("Not in gwt repo");
  });

  test("locks worktree without reason", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 0,
          stdout: { toString: () => "" },
          stderr: { toString: () => "" },
        }),
      }),
    } as any);

    await lock("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Locked 'feature'");
  });

  test("locks worktree with reason", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 0,
          stdout: { toString: () => "" },
          stderr: { toString: () => "" },
        }),
      }),
    } as any);

    await lock("feature", "work in progress");

    expect(consoleSpy).toHaveBeenCalledWith("Locked 'feature': work in progress");
  });

  test("throws on lock failure", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 1,
          stderr: { toString: () => "already locked" },
        }),
      }),
    } as any);

    await expect(lock("feature")).rejects.toThrow("Failed to lock worktree");
  });
});

describe("unlock", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
  });

  test("rejects invalid worktree name", async () => {
    mockIsValidWorktreeName.mockReturnValue(false);
    await expect(unlock("../bad")).rejects.toThrow("Invalid worktree name");
  });

  test("unlocks worktree", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 0,
          stdout: { toString: () => "" },
          stderr: { toString: () => "" },
        }),
      }),
    } as any);

    await unlock("feature");

    expect(consoleSpy).toHaveBeenCalledWith("Unlocked 'feature'");
  });

  test("throws on unlock failure", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 1,
          stderr: { toString: () => "not locked" },
        }),
      }),
    } as any);

    await expect(unlock("feature")).rejects.toThrow("Failed to unlock worktree");
  });
});

describe("move", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsValidWorktreeName.mockReturnValue(true);
    mockCheckGwtSetup.mockReturnValue({ ok: true });
    mockFindGwtRoot.mockReturnValue("/project");
  });

  test("rejects invalid worktree name", async () => {
    mockIsValidWorktreeName.mockReturnValue(false);
    await expect(move("../bad", "/new/path")).rejects.toThrow("Invalid worktree name");
  });

  test("rejects absolute path outside root", async () => {
    await expect(move("feature", "/tmp/elsewhere")).rejects.toThrow("Destination must be inside the repo root");
  });

  test("rejects relative path that escapes root", async () => {
    await expect(move("feature", "../escape")).rejects.toThrow("Destination must be inside the repo root");
  });

  test("rejects dest that equals root", async () => {
    await expect(move("feature", ".")).rejects.toThrow("Destination must be inside the repo root");
  });

  test("moves worktree to path inside root", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 0,
          stdout: { toString: () => "" },
          stderr: { toString: () => "" },
        }),
      }),
    } as any);

    await move("feature", "new-name");

    expect(consoleSpy).toHaveBeenCalledWith("Moved 'feature' to 'new-name'");
  });

  test("throws on move failure", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({
          exitCode: 1,
          stderr: { toString: () => "worktree is locked" },
        }),
      }),
    } as any);

    await expect(move("feature", "new-name")).rejects.toThrow("Failed to move worktree");
  });
});
