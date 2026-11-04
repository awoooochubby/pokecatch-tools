import type { Estimate } from './types';
import type {DungeonInfo,DungeonNode} from './dungeon';
export interface ForecastMember { uid: string; id: number; level: number; xp: number; cap: number; hp: number; maxHp: number; status: string; rank: number }
export interface ForecastCatalog { version: string; capturedAt: number; current: number; chapters: Array<{ id: number; name: string;entry?:number;dungeonName?:string }>;
  team: ForecastMember[]; autoSwitch: boolean; speed: number; stepMs: number; buddy: string | null; xpBoost: number;
  nodeIndex?:number; nodes?:DungeonNode[];dungeon?:DungeonInfo }
export interface ForecastOptions { chapters: number[]; trials: number; seed: number; start: 'full' | 'current';unit?:'dungeon' }
export interface ForecastMetric { xp: Estimate; rate: Estimate; levels: Estimate; capped: number }
export interface ForecastRow { chapter: number; name: string; trials: number; complete: Estimate; seconds: Estimate; steps: Estimate;
  battles: Estimate; faints: Estimate; xp: Estimate; rate: Estimate; members: Record<string, ForecastMetric>; error?: string }
export interface ForecastReport { catalog: ForecastCatalog; options: ForecastOptions; rows: ForecastRow[]; assumptions: string[]; generatedAt: number }
export interface NodeForecastOptions { trials:number;seed:number;scope:'full'|'remaining' }
export interface NodeForecastMetric { xp:Estimate;cumulative:Estimate;conditionalXp:{mean:number;samples:number}|null }
export interface NodeForecastRow extends DungeonNode { state:'computed'|'past'|'unavailable';reason?:string;
  reached:Estimate;complete:Estimate;metric:NodeForecastMetric|null;members:Record<string,NodeForecastMetric> }
export interface NodeForecastReport { catalog:ForecastCatalog;options:NodeForecastOptions;rows:NodeForecastRow[];trials:number;fromNode:number;
  xp:Estimate;members:Record<string,Estimate>;complete:Estimate|null;assumptions:string[];generatedAt:number }
export type ForecastRequest = { type: 'load'; source: string; save: string; now: number } | { type: 'run'; options: ForecastOptions } | {type:'nodes';options:NodeForecastOptions};
export type ForecastResponse = { type: 'catalog'; catalog: ForecastCatalog } | { type: 'progress'; completed: number; total: number; row?: ForecastRow }
  | { type: 'done'; report: ForecastReport } | {type:'nodes-done';report:NodeForecastReport} | { type: 'error'; message: string; fatal: boolean };
