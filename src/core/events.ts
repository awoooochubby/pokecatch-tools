export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();
  on<K extends keyof Events>(key: K, fn: (value: Events[K]) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, set);
    set.add(fn as (value: never) => void);
    return () => { set.delete(fn as (value: never) => void); };
  }
  emit<K extends keyof Events>(key: K, value: Events[K]) {
    for (const fn of this.listeners.get(key) ?? []) fn(value as never);
  }
  clear() { this.listeners.clear(); }
}
