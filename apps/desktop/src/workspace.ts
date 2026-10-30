import { useRef, useState } from "react";
import type { WorkspaceState, ViewMemory } from "../host/workspace";
export let memory: WorkspaceState;
export function initialize(state: WorkspaceState) {
  memory = state;
}
let pending: Promise<unknown> = Promise.resolve();
let failure: unknown;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let writeScheduled: (() => void) | undefined;
export function persist() {
  if (scheduled) clearTimeout(scheduled);
  if (!writeScheduled) {
    pending = new Promise<void>((resolve, reject) => {
      writeScheduled = () => {
        scheduled = undefined;
        writeScheduled = undefined;
        window.escode.lifecycle("persist", structuredClone(memory)).then(() => {
          failure = undefined; resolve();
        }, error => {
          failure = error;
          window.dispatchEvent(new CustomEvent("recovery-error", { detail: String(error) }));
          reject(error);
        });
      };
    });
    void pending.catch(() => {});
  }
  scheduled = setTimeout(() => writeScheduled?.(), 150);
  return pending;
}
export async function flush() {
  if (scheduled) clearTimeout(scheduled);
  writeScheduled?.();
  await pending;
  if (failure) throw failure;
}
export function useMemory<K extends keyof ViewMemory>(
  key: string,
  field: K,
  fallback: NonNullable<ViewMemory[K]>,
) {
  const [value, setValue] = useState<NonNullable<ViewMemory[K]>>(
    () => (memory.views[key]?.[field] as NonNullable<ViewMemory[K]>) ?? fallback,
  );
  const current = useRef(value);
  const update = (
    next:
      | NonNullable<ViewMemory[K]>
      | ((old: NonNullable<ViewMemory[K]>) => NonNullable<ViewMemory[K]>),
  ) => {
    const result = typeof next === "function" ? next(current.current) : next;
    current.current = result;
    memory.views[key] = { ...memory.views[key], [field]: result };
    void persist();
    setValue(result);
  };
  return [value, update] as const;
}
export const closers = new Map<string, { project: string; close: (discards: (() => () => void)[]) => Promise<boolean> }>();
