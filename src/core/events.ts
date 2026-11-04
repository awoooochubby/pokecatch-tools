export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<(value: never) => void>>();
  constructor(private onError: (error: unknown, key: keyof Events) => void = (error, key) => console.error(`PokeCatch 模块事件处理失败：${String(key)}`, error)) {}
  on<K extends keyof Events>(key: K, fn: (value: Events[K]) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, set);
    set.add(fn as (value: never) => void);
    return () => { set.delete(fn as (value: never) => void); };
  }
  emit<K extends keyof Events>(key: K, value: Events[K]) {
    for (const fn of this.listeners.get(key) ?? []) {
      try { fn(value as never); } catch (error) { this.onError(error, key); }
    }
  }
  clear() { this.listeners.clear(); }
}
