import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((config) => config),
  runCommand: vi.fn(),
  showUsage: vi.fn(),
}));

vi.mock("../commands/clone", () => ({ clone: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/add", () => ({ add: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/list", () => ({ list: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/rm", () => ({ rm: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/init", () => ({ init: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/cd", () => ({ cd: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/edit", () => ({ edit: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/run", () => ({ run: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/lock", () => ({ lock: vi.fn(() => Promise.resolve()), unlock: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/pr", () => ({ pr: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/mr", () => ({ mr: vi.fn(() => Promise.resolve()) }));
vi.mock("../commands/sync", () => ({ sync: vi.fn(() => Promise.resolve()) }));
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

  test("run command does not mutate process.argv", async () => {
    process.argv = ["node", "gwt", "run", "npm", "test"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "run", "npm", "test"]);
  });

  test("non-run subcommand argv is unchanged", async () => {
    process.argv = ["node", "gwt", "list"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "list"]);
  });

  test("move with 'run' as positional does not trigger run handling", async () => {
    process.argv = ["node", "gwt", "move", "run", "/tmp/path"];

    await import("../cli");

    expect(process.argv).toEqual(["node", "gwt", "move", "run", "/tmp/path"]);
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
    expect(commandNames).toContain("edit");
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("lock");
    expect(commandNames).toContain("unlock");
    expect(commandNames).toContain("move");
    expect(commandNames).toContain("pr");
    expect(commandNames).toContain("mr");
    expect(commandNames).toContain("sync");
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

  test("list command runs with options", async () => {
    process.argv = ["node", "gwt", "list"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { list } = await import("../commands/list");

    await import("../cli");

    const listConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "list"
    )?.[0];
    await listConfig?.run?.({ args: { json: true, names: false } });

    expect(list).toHaveBeenCalledWith({ json: true, names: false });
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

  test("cd command is defined with only name arg", async () => {
    process.argv = ["node", "gwt"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);

    await import("../cli");

    const cdConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "cd"
    )?.[0];

    expect(cdConfig?.args?.name?.type).toBe("positional");
    expect(cdConfig?.args?.open).toBeUndefined();
    expect(cdConfig?.args?.edit).toBeUndefined();
    expect(cdConfig?.args?.exec).toBeUndefined();
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

    await cdConfig?.run?.({ args: { name: "feature" } });

    expect(cd).toHaveBeenCalledWith("feature");
  });

  test("edit command is defined with name arg", async () => {
    process.argv = ["node", "gwt"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);

    await import("../cli");

    const editConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "edit"
    )?.[0];

    expect(editConfig?.args?.name?.type).toBe("positional");
    expect(editConfig?.args?.name?.required).toBe(false);
  });

  test("edit command calls edit function", async () => {
    process.argv = ["node", "gwt", "edit"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { edit } = await import("../commands/edit");

    await import("../cli");

    const editConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "edit"
    )?.[0];

    await editConfig?.run?.({ args: { name: "master", add: false } });

    expect(edit).toHaveBeenCalledWith("master", { add: false });
  });

  test("run command passes args._ and args.worktree to run()", async () => {
    process.argv = ["node", "gwt", "run"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { run } = await import("../commands/run");

    await import("../cli");

    const runConfig = mockDefineCommand.mock.calls.find(
      (call) => call[0].meta?.name === "run"
    )?.[0];

    await runConfig?.run?.({ args: { _: ["npm", "test"], worktree: undefined } });

    expect(run).toHaveBeenCalledWith(["npm", "test"], undefined);
  });

  test("run command passes -w worktree from args", async () => {
    process.argv = ["node", "gwt", "run"];

    const { defineCommand } = await import("citty");
    const mockDefineCommand = vi.mocked(defineCommand);
    const { run } = await import("../commands/run");
    vi.mocked(run).mockClear();

    await import("../cli");

    const runConfig = mockDefineCommand.mock.calls
      .filter((call) => call[0].meta?.name === "run")
      .at(-1)?.[0];

    await runConfig?.run?.({ args: { _: ["echo", "hi"], worktree: "master" } });

    expect(run).toHaveBeenLastCalledWith(["echo", "hi"], "master");
  });
});
