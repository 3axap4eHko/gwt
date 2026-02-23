import { describe, test, expect } from "vitest";
import { isValidWorktreeName } from "../core/validation";

describe("isValidWorktreeName", () => {
  test("accepts valid names", () => {
    expect(isValidWorktreeName("feature")).toBe(true);
    expect(isValidWorktreeName("my-feature")).toBe(true);
    expect(isValidWorktreeName("feature_123")).toBe(true);
    expect(isValidWorktreeName("CAPS")).toBe(true);
    expect(isValidWorktreeName("a")).toBe(true);
  });

  test("rejects path traversal", () => {
    expect(isValidWorktreeName("..")).toBe(false);
    expect(isValidWorktreeName("../etc")).toBe(false);
    expect(isValidWorktreeName("foo/..")).toBe(false);
    expect(isValidWorktreeName("foo/../bar")).toBe(false);
  });

  test("rejects absolute paths", () => {
    expect(isValidWorktreeName("/etc")).toBe(false);
    expect(isValidWorktreeName("/home/user")).toBe(false);
    expect(isValidWorktreeName("/")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidWorktreeName("")).toBe(false);
  });

  test("allows relative subdirectories", () => {
    expect(isValidWorktreeName("foo/bar")).toBe(true);
    expect(isValidWorktreeName("a/b/c")).toBe(true);
  });

  test("allows dots in names", () => {
    expect(isValidWorktreeName("v1.0.0")).toBe(true);
    expect(isValidWorktreeName("file.txt")).toBe(true);
  });

  test("rejects reserved names", () => {
    expect(isValidWorktreeName(".bare")).toBe(false);
    expect(isValidWorktreeName(".git")).toBe(false);
  });

  test("rejects whitespace-only names", () => {
    expect(isValidWorktreeName(" ")).toBe(false);
    expect(isValidWorktreeName("  ")).toBe(false);
    expect(isValidWorktreeName("\t")).toBe(false);
    expect(isValidWorktreeName("\n")).toBe(false);
  });

  test("rejects invalid git ref characters", () => {
    expect(isValidWorktreeName("foo~1")).toBe(false);
    expect(isValidWorktreeName("foo^2")).toBe(false);
    expect(isValidWorktreeName("foo:bar")).toBe(false);
    expect(isValidWorktreeName("foo?")).toBe(false);
    expect(isValidWorktreeName("foo*")).toBe(false);
    expect(isValidWorktreeName("foo[0]")).toBe(false);
    expect(isValidWorktreeName("foo\\bar")).toBe(false);
  });

  test("rejects invalid git ref patterns", () => {
    expect(isValidWorktreeName("-flag")).toBe(false);
    expect(isValidWorktreeName("name.lock")).toBe(false);
    expect(isValidWorktreeName("foo//bar")).toBe(false);
    expect(isValidWorktreeName("@{")).toBe(false);
    expect(isValidWorktreeName("@")).toBe(false);
    expect(isValidWorktreeName(".hidden")).toBe(false);
    expect(isValidWorktreeName("foo/")).toBe(false);
    expect(isValidWorktreeName("foo/.bar")).toBe(false);
    expect(isValidWorktreeName("foo/bar.")).toBe(false);
  });
});
