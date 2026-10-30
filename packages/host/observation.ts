// Only in-flight observations are cached; completed state is always rebuildable.
export function coalesceObservation<A>(scan: (root: string) => Promise<A>) {
  const pending = new Map<string, { dirty: boolean; result: Promise<A> }>();
  return (root: string): Promise<A> => {
    const previous = pending.get(root);
    if (previous) { previous.dirty = true; return previous.result; }
    const entry = { dirty: false, result: undefined as unknown as Promise<A> };
    pending.set(root, entry);
    entry.result = (async () => {
      try {
        let value: A;
        do {
          entry.dirty = false;
          value = await scan(root);
        } while (entry.dirty);
        return value;
      } finally { pending.delete(root); }
    })();
    return entry.result;
  };
}
