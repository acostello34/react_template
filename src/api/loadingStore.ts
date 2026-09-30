import { useSyncExternalStore } from 'react';

/**
 * Global in-flight request counter.
 *
 * Lives outside React so the axios interceptors can touch it without a
 * provider, and is read back through `useSyncExternalStore` so any component
 * can render a spinner. A counter rather than a boolean: concurrent requests
 * would otherwise clear each other's loading state.
 */

let pending = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const globalLoading = {
  start(): void {
    pending += 1;
    if (pending === 1) emit();
  },

  done(): void {
    if (pending === 0) return;
    pending -= 1;
    if (pending === 0) emit();
  },

  /** Escape hatch for non-axios async work that should show the same spinner. */
  async track<T>(work: Promise<T>): Promise<T> {
    globalLoading.start();
    try {
      return await work;
    } finally {
      globalLoading.done();
    }
  },

  /** Panic button — e.g. on route change after an aborted navigation. */
  reset(): void {
    if (pending === 0) return;
    pending = 0;
    emit();
  },

  getCount(): number {
    return pending;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): boolean => pending > 0;
const getServerSnapshot = (): boolean => false;

/** True while any non-silent request is in flight. */
export function useGlobalLoading(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
