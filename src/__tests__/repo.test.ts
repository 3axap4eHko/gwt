import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseWorktreeList,
  getCurrentVersion,
  findGwtRoot,
  getGwtConfig,
  getDefaultBranch,
  isGwtManaged,
  needsUpgrade,
  checkGwtSetup,
  clearCache,
  detectDefaultBranch,
} from "../core/repo";
import { existsSync, readFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("parseWorktreeList", () => {
  test("parses single worktree", () => {
    const output = `worktree /home/user/project/main
HEAD abc123def456
branch refs/heads/main`;

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "/home/user/project/main",
      name: "main",
      commit: "abc123def456",
      branch: "main",
      isBare: false,
    });
  });

  test("parses multiple worktrees", () => {
    const output = `worktree /home/user/project/main
HEAD abc123
branch refs/heads/main

worktree /home/user/project/feature
HEAD def456
branch refs/heads/feature-branch`;

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("main");
    expect(result[0].branch).toBe("main");
    expect(result[1].name).toBe("feature");
    expect(result[1].branch).toBe("feature-branch");
  });

  test("parses bare repository", () => {
    const output = `worktree /home/user/project/.bare
bare

worktree /home/user/project/main
HEAD abc123
branch refs/heads/main`;

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(2);
    expect(result[0].isBare).toBe(true);
    expect(result[1].isBare).toBe(false);
  });

  test("parses detached HEAD", () => {
    const output = `worktree /home/user/project/detached
HEAD abc123
detached`;

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(1);
    expect(result[0].branch).toBeNull();
    expect(result[0].commit).toBe("abc123");
  });

  test("handles empty output", () => {
    const result = parseWorktreeList("");
    expect(result).toHaveLength(0);
  });

  test("extracts basename as name", () => {
    const output = `worktree /very/long/path/to/my-feature
HEAD abc123
branch refs/heads/my-feature`;

    const result = parseWorktreeList(output);

    expect(result[0].name).toBe("my-feature");
    expect(result[0].path).toBe("/very/long/path/to/my-feature");
  });

  test("handles entry without path", () => {
    const output = `HEAD abc123
branch refs/heads/main`;

    const result = parseWorktreeList(output);
    expect(result).toHaveLength(0);
  });

  test("handles unknown line types", () => {
    const output = `worktree /home/user/project/main
HEAD abc123
branch refs/heads/main
unknown line here`;

    const result = parseWorktreeList(output);
    expect(result).toHaveLength(1);
    expect(result[0].branch).toBe("main");
  });
});

describe("getCurrentVersion", () => {
  test("returns version string", () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("returns consistent value", () => {
    expect(getCurrentVersion()).toBe(getCurrentVersion());
  });
});

describe("findGwtRoot", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("finds root with .bare directory", () => {
    mockExistsSync.mockImplementation((path) => {
      return path === "/home/user/project/.bare";
    });

    const result = findGwtRoot("/home/user/project/subdir");
    expect(result).toBe("/home/user/project");
  });

  test("finds root via .git file pointing to parent .bare", () => {
    mockExistsSync.mockImplementation((path) => {
      if (path === "/home/user/project/main/.git") return true;
      if (path === "/home/user/project/.bare") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("gitdir: ../.bare\n");

    const result = findGwtRoot("/home/user/project/main");
    expect(result).toBe("/home/user/project");
  });

  test("finds and caches root via .git file without startDir", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project/main");
    mockExistsSync.mockImplementation((path) => {
      if (path === "/home/user/project/main/.git") return true;
      if (path === "/home/user/project/.bare") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("gitdir: ../.bare\n");

    const result = findGwtRoot();
    expect(result).toBe("/home/user/project");

    // Clear and verify cache is used
    mockExistsSync.mockClear();
    const result2 = findGwtRoot();
    expect(result2).toBe("/home/user/project");
    expect(mockExistsSync).not.toHaveBeenCalled(); // Cache used, no file checks
  });

  test("returns null when no root found", () => {
    mockExistsSync.mockReturnValue(false);

    const result = findGwtRoot("/home/user/project");
    expect(result).toBeNull();
  });

  test("caches result when no startDir provided", () => {
    mockExistsSync.mockImplementation((path) => {
      return path === "/home/user/project/.bare";
    });
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");

    findGwtRoot();
    findGwtRoot();

    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  test("does not cache when startDir provided", () => {
    mockExistsSync.mockImplementation((path) => {
      return path === "/home/user/project/.bare";
    });

    findGwtRoot("/home/user/project");
    findGwtRoot("/home/user/project");

    expect(mockExistsSync).toHaveBeenCalledTimes(2);
  });

  test("handles .git file read error", () => {
    mockExistsSync.mockImplementation((path) => {
      if (path === "/test/.git") return true;
      return false;
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error("Read error");
    });

    const result = findGwtRoot("/test");
    expect(result).toBeNull();
  });

  test("ignores .git file not starting with gitdir:", () => {
    mockExistsSync.mockImplementation((path) => {
      if (path === "/test/.git") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("not a gitdir file");

    const result = findGwtRoot("/test");
    expect(result).toBeNull();
  });

  test("ignores .git file when parent has no .bare", () => {
    mockExistsSync.mockImplementation((path) => {
      if (path === "/home/user/project/main/.git") return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("gitdir: ../.bare\n");

    const result = findGwtRoot("/home/user/project/main");
    expect(result).toBeNull();
  });
});

describe("getGwtConfig", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("returns null when no root found", () => {
    mockExistsSync.mockReturnValue(false);

    const result = getGwtConfig();
    expect(result).toBeNull();
  });

  test("returns null when config file does not exist", () => {
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".bare")) return true;
      if (typeof path === "string" && path.endsWith("config")) return false;
      return false;
    });
    vi.spyOn(process, "cwd").mockReturnValue("/project");

    const result = getGwtConfig();
    expect(result).toBeNull();
  });

  test("parses config with gwt section", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[core]
  bare = true
[gwt]
  version = 0.1.0
  defaultBranch = main
[remote "origin"]
  url = git@github.com:test/repo.git`);

    const result = getGwtConfig();
    expect(result).toEqual({
      version: "0.1.0",
      defaultBranch: "main",
    });
  });

  test("returns null values when gwt section missing", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[core]
  bare = true`);

    const result = getGwtConfig();
    expect(result).toEqual({
      version: null,
      defaultBranch: null,
    });
  });

  test("handles config read error", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith("config")) {
        throw new Error("Read error");
      }
      return "";
    });

    const result = getGwtConfig();
    expect(result).toBeNull();
  });

  test("caches config result", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = 0.1.0`);

    getGwtConfig();
    getGwtConfig();

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("getDefaultBranch", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("returns defaultBranch from config", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  defaultBranch = develop`);

    expect(getDefaultBranch()).toBe("develop");
  });

  test("returns null when no config", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getDefaultBranch()).toBeNull();
  });
});

describe("isGwtManaged", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("returns true when version exists", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = 0.1.0`);

    expect(isGwtManaged()).toBe(true);
  });

  test("returns false when no version", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[core]
  bare = true`);

    expect(isGwtManaged()).toBe(false);
  });
});

describe("needsUpgrade", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("returns false when no config", () => {
    mockExistsSync.mockReturnValue(false);
    expect(needsUpgrade()).toBe(false);
  });

  test("returns false when version matches", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = ${getCurrentVersion()}`);

    expect(needsUpgrade()).toBe(false);
  });

  test("returns true when version differs", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = 0.0.1`);

    expect(needsUpgrade()).toBe(true);
  });
});

describe("checkGwtSetup", () => {
  beforeEach(() => {
    clearCache();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  test("returns error when no root found", () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkGwtSetup();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Not in a gwt-managed repository");
  });

  test("returns error when not gwt-managed", () => {
    mockExistsSync.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".bare")) return true;
      if (typeof path === "string" && path.endsWith("config")) return true;
      return false;
    });
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[core]
  bare = true`);

    const result = checkGwtSetup();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Run 'gwt init' to set up");
  });

  test("returns ok when properly setup", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = 0.1.0`);

    const result = checkGwtSetup();
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("clearCache", () => {
  test("clears cached values", () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue("/project");
    mockReadFileSync.mockReturnValue(`[gwt]
  version = 0.1.0`);

    getGwtConfig();
    clearCache();
    getGwtConfig();

    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });
});

describe("detectDefaultBranch", () => {
  const mockShell = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockShell.mockReset();
  });

  test("returns branch from symbolic-ref", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () =>
          Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "refs/remotes/origin/main\n" },
          }),
      }),
    } as any);

    const result = await detectDefaultBranch();
    expect(result).toBe("main");
  });

  test("falls back to common branch names", async () => {
    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ exitCode: 1 });
          }
          if (callCount === 2) {
            return Promise.resolve({ exitCode: 1 });
          }
          return Promise.resolve({ exitCode: 0 });
        },
      }),
    } as any);

    const result = await detectDefaultBranch();
    expect(result).toBe("main");
  });

  test("falls back to first remote branch", async () => {
    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount <= 5) {
            return Promise.resolve({ exitCode: 1 });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "  origin/feature\n  origin/HEAD -> origin/main" },
          });
        },
      }),
    } as any);

    const result = await detectDefaultBranch();
    expect(result).toBe("feature");
  });

  test("returns master as last resort", async () => {
    const { $ } = await import("bun");
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => Promise.resolve({ exitCode: 1 }),
      }),
    } as any);

    const result = await detectDefaultBranch();
    expect(result).toBe("master");
  });

  test("skips branches with arrow in name", async () => {
    const { $ } = await import("bun");
    let callCount = 0;
    vi.mocked($).mockReturnValue({
      quiet: () => ({
        nothrow: () => {
          callCount++;
          if (callCount <= 5) {
            return Promise.resolve({ exitCode: 1 });
          }
          return Promise.resolve({
            exitCode: 0,
            stdout: { toString: () => "  origin/HEAD -> origin/main\n  origin/develop" },
          });
        },
      }),
    } as any);

    const result = await detectDefaultBranch();
    expect(result).toBe("develop");
  });
});
