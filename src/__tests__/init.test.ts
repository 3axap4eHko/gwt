import { describe, test, expect, vi, beforeEach } from "vitest";
import { init } from "../commands/init";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../core/repo", () => ({
  findGwtRoot: vi.fn(),
  getGwtConfig: vi.fn(),
  getCurrentVersion: vi.fn(() => "0.1.0"),
  detectDefaultBranch: vi.fn(() => Promise.resolve("master")),
}));

import { existsSync } from "fs";
import { findGwtRoot, getGwtConfig, getCurrentVersion, detectDefaultBranch } from "../core/repo";

const mockExistsSync = vi.mocked(existsSync);
const mockFindGwtRoot = vi.mocked(findGwtRoot);
const mockGetGwtConfig = vi.mocked(getGwtConfig);
const mockGetCurrentVersion = vi.mocked(getCurrentVersion);
const mockDetectDefaultBranch = vi.mocked(detectDefaultBranch);

describe("init", () => {
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

    // Mock Bun.write and Bun.file
    (globalThis as any).Bun = {
      write: vi.fn(() => Promise.resolve()),
      file: vi.fn(() => ({
        text: () => Promise.resolve("# AGENTS.md content"),
      })),
    };
  });

  test("exits with error when no .bare directory found", async () => {
    mockFindGwtRoot.mockReturnValue(null);

    const error = await init().catch((e: Error) => e);
    expect(error.message).toContain("Error: No .bare directory found");
    expect(error.message).toContain("Run this command from a bare worktree repository root or inside a worktree");
  });

  test("returns early when already initialized with same version", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: "0.1.0", defaultBranch: "master" });
    mockGetCurrentVersion.mockReturnValue("0.1.0");

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("Already initialized (v0.1.0)");
  });

  test("upgrades when version differs", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: "0.0.1", defaultBranch: "master" });
    mockGetCurrentVersion.mockReturnValue("0.1.0");
    mockExistsSync.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("Upgrading from v0.0.1 to v0.1.0...");
    expect(consoleSpy).toHaveBeenCalledWith("Done! Repository initialized for gwt v0.1.0");
  });

  test("initializes when no version exists", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: null });
    mockExistsSync.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("Initializing gwt...");
  });

  test("creates .git file when missing", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: "master" });
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === "string" && path.includes(".git")) return false;
      return true;
    });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect((globalThis as any).Bun.write).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("  Created .git file");
  });

  test("creates AGENTS.md when missing", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: "master" });
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === "string" && path.includes("AGENTS.md")) return false;
      return true;
    });

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("  Created AGENTS.md");
  });

  test("exits on fetch config failure", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: "master" });
    mockExistsSync.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 1 }),
      }),
    } as any);

    await expect(init()).rejects.toThrow("Error: Failed to configure fetch refspec");
  });

  test("detects default branch when not set", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: null });
    mockExistsSync.mockReturnValue(true);
    mockDetectDefaultBranch.mockResolvedValue("develop");

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("  Default branch: develop");
  });

  test("skips default branch detection when already set", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: "master" });
    mockExistsSync.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(mockDetectDefaultBranch).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("Default branch:"));
  });

  test("completes successfully", async () => {
    mockFindGwtRoot.mockReturnValue("/project");
    mockGetGwtConfig.mockReturnValue({ version: null, defaultBranch: "master" });
    mockExistsSync.mockReturnValue(true);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 0 }),
      }),
    } as any);

    await init();

    expect(consoleSpy).toHaveBeenCalledWith("Done! Repository initialized for gwt v0.1.0");
  });
});
