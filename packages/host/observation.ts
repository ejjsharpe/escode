// Completed observations are delivered even while the next refresh is dirty.
export function coalesceObservation<A>(scan: (root: string) => Promise<A>) {
  const pending = new Map<string, Promise<A>>();
  const dirty = new Map<string, Promise<A>>();
  return function observe(root: string): Promise<A> {
    const current = pending.get(root);
    if (current) {
      let next = dirty.get(root);
      if (!next) {
        next = current.catch(() => undefined).then(() => {
          dirty.delete(root);
          return observe(root);
        });
        dirty.set(root, next);
      }
      return next;
    }
    const result = Promise.resolve().then(() => scan(root)).finally(() => pending.delete(root));
    pending.set(root, result);
    return result;
  };
}
