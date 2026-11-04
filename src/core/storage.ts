export const STORAGE_KEY = 'pc-tools-v1';
export interface Envelope { schema: 1; data: Record<string, unknown> }
export class Store {
  private envelope: Envelope;
  private locked = false;
  private unsupportedRaw: string | null = null;
  error = '';
  constructor(private storage: Storage) {
    this.envelope = { schema: 1, data: {} };
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { this.error = '本地存储不可用'; }
    let saved: unknown;
    try { saved = raw === null ? null : JSON.parse(raw); } catch { saved = null; }
    if (saved && typeof saved === 'object' && !Array.isArray(saved) && (saved as Envelope).schema === 1
      && (saved as Envelope).data && typeof (saved as Envelope).data === 'object' && !Array.isArray((saved as Envelope).data)) {
      this.envelope = saved as Envelope;
    } else if (raw !== null) {
      // Preserve unknown schemas rather than replacing data from a newer release.
      this.error = '数据版本不支持，请先导出备份';
      this.locked = true; this.unsupportedRaw = raw;
    } else {
      for (const [target, legacy] of Object.entries({ stats: 'pc-stat-v1', session: 'pc-stat-session-v1', enemies: 'pc-enemies-center-history' })) {
        const value = this.read(legacy);
        if (value) this.envelope.data[target] = value;
      }
      if (!this.envelope.data.enemies) {
        const maps = this.read('pc-enemies-stages-v2') as Record<string, unknown> | null;
        const point = this.read('pc-enemies-stages-v2-checkpoint') as { key?: string } | null;
        const old = point?.key && maps?.[point.key];
        if (old) this.envelope.data.legacyStage = old;
      }
      this.persist();
    }
  }
  private read(key: string): unknown { try { return JSON.parse(this.storage.getItem(key) || 'null'); } catch { return null; } }
  get<T>(key: string, fallback: T): T { return (this.envelope.data[key] as T | undefined) ?? fallback; }
  set(key: string, value: unknown) { this.envelope.data[key] = value; this.persist(); }
  private persist() {
    if (this.locked) return;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.envelope)); this.error = ''; }
    catch { this.error = '本地存储已满或不可用，本次数据仅保留在内存'; }
  }
  export() {
    const legacy: Record<string, unknown> = {};
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i)!;
      if (key.startsWith('pc-') && key !== STORAGE_KEY) legacy[key] = this.read(key);
    }
    return { ...this.envelope, legacy,
      ...(this.locked ? { unsupportedData: this.read(STORAGE_KEY), unsupportedRaw: this.unsupportedRaw } : {}) };
  }
}
