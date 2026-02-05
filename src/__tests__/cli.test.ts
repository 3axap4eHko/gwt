import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((config) => config),
  runMain: vi.fn(),
}));

vi.mock("../commands/clone", () => ({ clone: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/add", () => ({ add: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/list", () => ({ list: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/rm", () => ({ rm: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/init", () => ({ init: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/cd", () => ({ cd: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/shell", () => ({ shell: vi.fn() }));

describe("cli", () => {
  let originalArgv: string[];
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    originalArgv = process.argv;
    mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    mockExit.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("extracts --exec arguments from argv", async () => {
    process.argv = ["node", "gwt", "cd", "main", "--exec", "echo", "hello"];

    const { defineCommand, runMain } = await import("citty");

    await import("../cli");

    expect(runMain).toHaveBeenCalled();
    expect(process.argv).toEqual(["node", "gwt", "cd", "main"]);
  });

  test("extracts -x short flag arguments", async () => {
    process.argv = ["node", "gwt", "cd", "-x", "ls", "-la"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "cd"]);
  });

  test("handles no --exec flag", async () => {
    process.argv = ["node", "gwt", "list"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "list"]);
  });

  test("handles empty --exec arguments", async () => {
    process.argv = ["node", "gwt", "cd", "--exec"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "cd"]);
  });

  test("defines all subcommands", async () => {
    process.argv = ["node", "gwt"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);

    await import("../cli");

    const calls = mockDefineCommand.mock.calls;
    const commandNames = calls
      .filter((call) => call[0].meta?.name)
      .map((call) => call[0].meta.name);

    expect(commandNames).toContain("clone");
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("add");
    expect(commandNames).toContain("rm");
    expect(commandNames).toContain("list");
    expect(commandNames).toContain("cd");
    expect(commandNames).toContain("shell");
    expect(commandNames).toContain("gwt");
  });

  test("clone command runs with url and dest", async () => {
    process.argv = ["node", "gwt", "clone"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { clone } = await import("../commands/clone");

    await import("../cli");

    const cloneConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "clone"
    )?.[0];
    await cloneConfig?.run?.({ args: { url: "https://github.com/test/repo", dest: "myrepo" } });

    expect(clone).toHaveBeenCalledWith("https://github.com/test/repo", "myrepo");
  });

  test("add command runs with name and from option", async () => {
    process.argv = ["node", "gwt", "add"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { add } = await import("../commands/add");

    await import("../cli");

    const addConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "add"
    )?.[0];
    await addConfig?.run?.({ args: { name: "feature", from: "develop" } });

    expect(add).toHaveBeenCalledWith("feature", { from: "develop" });
  });

  test("rm command runs with name and force option", async () => {
    process.argv = ["node", "gwt", "rm"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { rm } = await import("../commands/rm");

    await import("../cli");

    const rmConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "rm"
    )?.[0];
    await rmConfig?.run?.({ args: { name: "feature", force: true } });

    expect(rm).toHaveBeenCalledWith("feature", { force: true });
  });

  test("list command runs", async () => {
    process.argv = ["node", "gwt", "list"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { list } = await import("../commands/list");

    await import("../cli");

    const listConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "list"
    )?.[0];
    await listConfig?.run?.({ args: {} });

    expect(list).toHaveBeenCalled();
  });

  test("init command runs", async () => {
    process.argv = ["node", "gwt", "init"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { init } = await import("../commands/init");

    await import("../cli");

    const initConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "init"
    )?.[0];
    await initConfig?.run?.({ args: {} });

    expect(init).toHaveBeenCalled();
  });

  test("shell command runs with shell type", async () => {
    process.argv = ["node", "gwt", "shell"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { shell } = await import("../commands/shell");

    await import("../cli");

    const shellConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "shell"
    )?.[0];
    shellConfig?.run?.({ args: { shell: "bash" } });

    expect(shell).toHaveBeenCalledWith("bash");
  });

  test("cd command is defined with correct args", async () => {
    process.argv = ["node", "gwt"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);

    await import("../cli");

    const cdConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "cd"
    )?.[0];

    expect(cdConfig?.args?.name?.type).toBe("positional");
    expect(cdConfig?.args?.open?.type).toBe("boolean");
    expect(cdConfig?.args?.edit?.type).toBe("boolean");
    expect(cdConfig?.args?.exec?.type).toBe("boolean");
  });

  test("cd command calls cd function", async () => {
    process.argv = ["node", "gwt", "cd"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { cd } = await import("../commands/cd");

    await import("../cli");

    const cdConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "cd"
    )?.[0];

    await cdConfig?.run?.({ args: { name: "feature", open: false, edit: false, exec: false } });

    expect(cd).toHaveBeenCalled();
  });

  test("cd command errors when multiple options provided with exec", async () => {
    process.argv = ["node", "gwt", "cd", "--exec", "ls"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);

    await import("../cli");

    const cdConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "cd"
    )?.[0];

    expect(() =>
      cdConfig?.run?.({ args: { name: "main", open: true, edit: false, exec: false } })
    ).toThrow("process.exit");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: --open, --edit, and --exec are mutually exclusive"
    );
  });

});
