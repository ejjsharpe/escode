import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

// Callers serialize writes to each target; success includes the containing directory sync.
export async function atomicWriteJson(file: string, value: () => unknown) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + ".tmp";
  const fd = await open(temporary, "w", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value()));
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(temporary, file);
  const directory = await open(dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
