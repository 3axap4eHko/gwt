import { describe, test, expect, vi, beforeEach } from "vitest";
import { clone } from "../commands/clone";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../core/repo", () => ({
  getCurrentVersion: vi.fn(() => "0.1.0"),
  detectDefaultBranch: vi.fn(() => Promise.resolve("master")),
  debug: vi.fn(),
}));

import { existsSync, mkdirSync } from "fs";

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);

describe("clone", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(process, "chdir").mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock Bun.write and Bun.file
    (globalThis as any).Bun = {
      write: vi.fn(() => Promise.resolve()),
      file: vi.fn(() => ({
        text: () => Promise.resolve("# AGENTS.md content"),
      })),
    };
  });

  test("exits with error when directory already exists", async () => {
    mockExistsSync.mockReturnValue(true);

    await expect(clone("https://github.com/test/repo.git")).rejects.toThrow("Error: Directory 'repo' already exists");
  });

  test("extracts repo name from URL", async () => {
    mockExistsSync.mockReturnValue(false);

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

    await clone("https://github.com/test/my-repo.git");

    expect(consoleSpy).toHaveBeenCalledWith("Cloning https://github.com/test/my-repo.git into my-repo/");
  });

  test("uses custom destination if provided", async () => {
    mockExistsSync.mockReturnValue(false);

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

    await clone("https://github.com/test/repo.git", "custom-name");

    expect(consoleSpy).toHaveBeenCalledWith("Cloning https://github.com/test/repo.git into custom-name/");
  });

  test("creates directory and clones bare repo", async () => {
    mockExistsSync.mockReturnValue(false);

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

    await clone("https://github.com/test/repo.git");

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("  Creating bare repository...");
  });

  test("exits on clone failure", async () => {
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 1,
            stderr: { toString: () => "fatal: repository not found" },
          }),
      }),
    } as any);

    await expect(clone("https://github.com/test/repo.git")).rejects.toThrow("Error: Failed to clone repository");
  });

  test("exits on fetch config failure", async () => {
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // First call: clone succeeds
          if (callCount === 1) return Promise.resolve({ exitCode: 0 });
          // Second call: config fails
          return Promise.resolve({ exitCode: 1 });
        },
      }),
    } as any);

    await expect(clone("https://github.com/test/repo.git")).rejects.toThrow("Error: Failed to configure fetch refspec");
  });

  test("exits on fetch failure", async () => {
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Calls 1-3: clone and config succeed
          if (callCount <= 3) return Promise.resolve({ exitCode: 0 });
          // Call 4: fetch fails
          return Promise.resolve({ exitCode: 1, stderr: { toString: () => "network error" } });
        },
      }),
    } as any);

    await expect(clone("https://github.com/test/repo.git")).rejects.toThrow("Error: Failed to fetch branches");
  });

  test("exits on worktree creation failure", async () => {
    mockExistsSync.mockReturnValue(false);

    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          // Calls 1-6: all setup succeeds
          if (callCount <= 6) return Promise.resolve({ exitCode: 0, stdout: { toString: () => "" } });
          // Call 7: worktree add fails
          return Promise.resolve({ exitCode: 1, stderr: { toString: () => "worktree error" } });
        },
      }),
    } as any);

    await expect(clone("https://github.com/test/repo.git")).rejects.toThrow("Error: Failed to create worktree");
  });

  test("completes successfully", async () => {
    mockExistsSync.mockReturnValue(false);

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

    await clone("https://github.com/test/repo.git");

    expect(consoleSpy).toHaveBeenCalledWith("Done! Repository cloned to repo/");
    expect(consoleSpy).toHaveBeenCalledWith("  cd repo/master");
  });

  test("writes .git file and AGENTS.md", async () => {
    mockExistsSync.mockReturnValue(false);

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

    await clone("https://github.com/test/repo.git");

    expect((globalThis as any).Bun.write).toHaveBeenCalledWith(".git", "gitdir: ./.bare\n");
    expect((globalThis as any).Bun.write).toHaveBeenCalledWith("AGENTS.md", "# AGENTS.md content");
  });
});
