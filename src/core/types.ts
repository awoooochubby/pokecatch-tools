export interface Mon { uid: string | number; id: number; level: number; xp: number; hp?: number; rank?: number }
export interface GameSave {
  mons: Mon[]; team: Array<string | number>; stats?: { battles?: number };
  road?: Array<string | number> | null; travel?: { to?: string[] }; link?: { side?: string; from?: string };
  adv: { runs: number; chapter?: number | string; unlocked?: number; node?: number; paused?: boolean;
    event?: unknown; zone?: unknown; tower?: unknown; nodes?: Array<{ name?: string }>;
    battle?: { kind?: string; enemies: Array<{ uid: string | number; id: number; hp: number }> } | null };
}
export interface Damage { value: number; healing: boolean; status: boolean; critical: boolean; victim: string | null; side: 'ally' | 'enemy' | null }
export interface GameEvents {
  sample: { save: GameSave; now: number; gap: boolean; visible?: boolean };
  log: string; damage: Damage; center: string; defeat: string;
  status: string;
}
export interface FeatureModule { id: string; start(): void; stop(): void }
