export interface Candidate { uid: string; id: number; name: string; level: number; cap: number; hp: number; maxHp: number; status: string; shiny: boolean; rank: number; eligible: boolean; reason: string }
export interface Target {
  key: string; label: string; kind: 'wild' | 'trainer' | 'gym'; level: number; id: number;
  node: Record<string, unknown>; foes: Array<Record<string, unknown>>;
  /** Retains the original gym roster/HP multiplier when evaluating one member. */
  selected?: number; gym?: Record<string, unknown>; power?: number;
  source?: 'current' | 'wild' | 'trainer' | 'boss' | 'diagnostic'; nodeIndex?: number; preserveHp?: boolean; levelRange?: [number, number];
}
export interface Catalog { version: string; cap: number; candidates: Candidate[]; targets: Target[]; chapter: string; chapterIndex?: number; nodeIndex?: number; nodeName?: string; randomTrainers?: number; centers?:Array<{node:number;name:string}>;capturedAt: number; warnings: string[]; activeOrder: string[]; autoSwitch: boolean }
export interface Options {
  trials: number; seed: number; start: 'full' | 'current'; targetKeys: string[]; candidateUids: string[];
  scanLevels: boolean; sequence: boolean; maxLoss: number; minWin: number;
  mode: 'matrix' | 'route' | 'order'; autoSwitch: 'current' | 'on' | 'off';
}
export interface Estimate { mean: number; low: number; high: number }
export interface CombatFacts { order: string; move: string; damage: [number, number]; enemyHp: number; speed: number; enemySpeed: number }
export interface MatchResult {
  uid: string; id: number; target: string; targetId?: number; targetLevel?: number; level: number; trials: number; wins: number; win: Estimate; loss: Estimate;
  actions: Estimate; hits: Record<string, number>; facts: CombatFacts; qualified: boolean; trainingXp: number;
}
export interface RouteThreat { node: number; id?: number; label: string; wear: number; kos: number; samples: number; targetKey?: string }
export interface RouteFailure { node: number; id?: number; label: string; count: number; nextCenter: string | null; battlesToCenter: number; targetKey?: string }
export interface RouteResult { order: string[]; autoSwitch: boolean; trials: number; win: Estimate; loss: Estimate; wear: Estimate; kos: Estimate; baseline: boolean; qualified: boolean;
  threats?: RouteThreat[]; failures?: RouteFailure[] }
export interface Report { catalog: Catalog; options: Options; results: MatchResult[]; routes: RouteResult[]; generatedAt: number; assumptions: string[]; search?: string }
export type Request = { type: 'load'; source: string; save: string; now: number } | { type: 'run'; options: Options; custom?: { id: number; level: number }[] };
export type Response = { type: 'catalog'; catalog: Catalog } | { type: 'progress'; completed: number; total: number; result?: MatchResult; route?: RouteResult } | { type: 'done'; report: Report } | { type: 'error'; message: string; fatal: boolean };
