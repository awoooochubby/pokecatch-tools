import type { Estimate } from '../simulation/types';
export interface RaidAlly { uid: string; id: number; level: number; xp: number; shiny?: boolean; rank?: number; bot: boolean; statMult?: number; owner?: string; }
export interface RaidInput {
  region: string; boss: number; date: string; mine: Array<string | number>; allies: RaidAlly[];
  weather: string | null; source: 'configured' | 'active';
  alternateAllies?: RaidAlly[];
}
export interface RaidReport {
  input: RaidInput; trials: number; wins: number; win: Estimate; generatedAt: number;
  team: Array<{ id: number; name: string; level: number; shiny: boolean; ally: boolean }>;
  orderResults?: Estimate[];
  moves: { ally: Estimate; enemy: Estimate; total: Estimate };
  expectedClearMoves: number | null;
}
export interface RaidEntry {
  region: string; boss: number; date: string; done: boolean;
  input: RaidInput | null; error: string;
}
