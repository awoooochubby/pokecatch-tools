import type { Estimate } from './types';
export interface ForecastMember { uid: string; id: number; level: number; xp: number; cap: number; hp: number; maxHp: number; status: string; rank: number }
export interface ForecastCatalog { version: string; capturedAt: number; current: number; chapters: Array<{ id: number; name: string }>;
  team: ForecastMember[]; autoSwitch: boolean; speed: number; stepMs: number; buddy: string | null; xpBoost: number }
export interface ForecastOptions { chapters: number[]; trials: number; seed: number; start: 'full' | 'current' }
export interface ForecastMetric { xp: Estimate; rate: Estimate; levels: Estimate; capped: number }
export interface ForecastRow { chapter: number; name: string; trials: number; complete: Estimate; seconds: Estimate; steps: Estimate;
  battles: Estimate; faints: Estimate; xp: Estimate; rate: Estimate; members: Record<string, ForecastMetric>; error?: string }
export interface ForecastReport { catalog: ForecastCatalog; options: ForecastOptions; rows: ForecastRow[]; assumptions: string[]; generatedAt: number }
export type ForecastRequest = { type: 'load'; source: string; save: string; now: number } | { type: 'run'; options: ForecastOptions };
export type ForecastResponse = { type: 'catalog'; catalog: ForecastCatalog } | { type: 'progress'; completed: number; total: number; row?: ForecastRow }
  | { type: 'done'; report: ForecastReport } | { type: 'error'; message: string; fatal: boolean };
