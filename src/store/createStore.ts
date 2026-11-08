import { useStore } from 'zustand';
import { createStore as createZustandStore } from 'zustand/vanilla';

/**
 * App state is held in Zustand vanilla stores so native event handlers (outside React) and
 * components share one source of truth. `useValue(selector)` subscribes a component to a slice;
 * selectors must return existing references or primitives.
 */
export function createStore<T extends object>(initial: T) {
  const store = createZustandStore<T>()(() => initial);
  const get = store.getState;
  const set = (patch: Partial<T> | ((s: T) => Partial<T>)) => store.setState(patch as Partial<T>);
  // Named `useValue` (not `use`): React 19 reserves `use` for its conditional `use()` API, and the
  // React Compiler would otherwise treat these calls as conditional, breaking hook order.
  function useValue(): T;
  function useValue<U>(selector: (s: T) => U): U;
  function useValue<U>(selector?: (s: T) => U) {
    return useStore(store, selector ?? ((s: T) => s as unknown as U));
  }
  return { get, set, subscribe: store.subscribe, useValue, store };
}
