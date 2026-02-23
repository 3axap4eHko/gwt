import { $ } from "bun";
import { findGwtRoot, checkGwtSetup, getWorktrees } from "../core/repo";
import { resolveWorktree, selectWorktree } from "./cd";

interface EditOptions {
  add?: boolean;
}

export async function edit(name?: string, options: EditOptions = {}): Promise<void> {
  const check = checkGwtSetup();
  if (!check.ok) {
    throw new Error(`Error: ${check.error}`);
  }

  const root = findGwtRoot()!;
  process.chdir(root);

  const worktrees = await getWorktrees();

  if (worktrees.length === 0) {
    throw new Error("No worktrees found");
  }

  const wt = name ? resolveWorktree(worktrees, name) : await selectWorktree(worktrees);
  await openInEditor(wt.path, options.add);
  console.log(wt.path);
}

const ADD_SUPPORTED = new Set(["code", "cursor"]);

async function openInEditor(path: string, addToWorkspace?: boolean): Promise<void> {
  const ide = await detectIde();
  if (!ide) {
    throw new Error("No IDE found. Set one with: git config --global gwt.ide <ide>");
  }
  const useAdd = addToWorkspace && ADD_SUPPORTED.has(ide);
  const cmd = useAdd ? [ide, "--add", path] : [ide, path];
  const result = await $`${cmd}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(`Warning: Failed to open ${ide}`);
  }
}

async function detectIde(): Promise<string | null> {
  const configResult = await $`git config gwt.ide`.quiet().nothrow();
  if (configResult.exitCode === 0) {
    const ide = configResult.stdout.toString().trim();
    if (ide) return ide;
  }

  const visual = process.env.VISUAL;
  if (visual) return visual;

  const candidates = ["zed", "nvim", "cursor", "code"];
  for (const ide of candidates) {
    const result = await $`command -v ${ide}`.quiet().nothrow();
    if (result.exitCode === 0) {
      return ide;
    }
  }

  const editor = process.env.EDITOR;
  if (editor) return editor;

  return null;
}
