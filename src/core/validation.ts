export function isValidWorktreeName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.trim().length === 0) return false;
  if (name === ".bare" || name === ".git") return false;
  if (name.includes("..")) return false;
  if (name.startsWith("/")) return false;
  if (name.startsWith("-")) return false;
  if (name.endsWith("/")) return false;
  if (name.endsWith(".lock")) return false;
  if (name.includes("//")) return false;
  if (name.includes("@{")) return false;
  if (/[\x00-\x1f\x7f~^:?*\\[\]]/.test(name)) return false;
  if (name === "@") return false;
  for (const part of name.split("/")) {
    if (part.startsWith(".") || part.endsWith(".")) return false;
  }
  return true;
}
