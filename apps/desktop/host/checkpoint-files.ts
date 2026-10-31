// Shared content validation only; callers retain their own filesystem authority.
export function validateCheckpointFiles(files: unknown): asserts files is Record<string, { mode: number; content: string } | null> {
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.keys(files).length > 10000) throw Error("Invalid checkpoint files or capacity");
  let bytes = 0;
  for (const [path, file] of Object.entries(files)) {
    if (!path || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === ".." || p === ".git")) throw Error("Invalid checkpoint path");
    if (file === null) continue;
    if (!file || typeof file.content !== "string" || ![0o100644, 0o100755, 0o120000].includes(file.mode)) throw Error("Invalid captured file");
    const content = Buffer.from(file.content, "base64"); bytes += content.length;
    if (content.toString("base64") !== file.content || bytes > 8 * 1024 * 1024) throw Error("Invalid captured contents or capacity");
  }
}
