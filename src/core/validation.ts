export function isValidWorktreeName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.trim().length === 0) return false;
  if (name === ".bare" || name === ".git") return false;
  if (name.includes("..")) return false;
  if (name.startsWith("/")) return false;
  return true;
}
