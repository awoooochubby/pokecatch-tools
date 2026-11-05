export type HuntKind = 'roaming' | 'zone' | 'weather' | 'wild' | 'raid';
export interface Destination {
  chapter: number; region: string; name: string; zone?: number;
  until?: number; weather?: string; chance?: number; habitats?: string[];
  staticId?: number;
  raid?: string; date?: string; boss?: number;
}
export interface HuntTarget {
  id: number; name: string; kind: HuntKind; owned: boolean; status: string;
  destinations: Destination[];
  dexMissing?: boolean;
}
export interface HuntBerry { key: string; name: string; family: string; mult: number; minutes: number; stock: number; }
export interface HuntMon { uid: string; id: number; name: string; level: number; shiny: boolean; }
export interface HuntCatalog { now: number; targets: HuntTarget[]; chapter: number; team: string[]; berries?: HuntBerry[]; box?: HuntMon[]; presets?: Array<{ name: string; team: string[] }>; }
export interface HuntJob { id: number; kind: HuntKind; destination: Destination; interrupt: boolean; }
export interface TrackerPrefs { targets: number[]; mode: 'interrupt' | 'ordered'; weather: number[] | null; berries: string[];
  teams?: Record<string, string[]>; defaultTeam?: string[]; raidAuto?: boolean;
}
export interface HuntPrediction { id: number; team: string[]; destination: Destination; trials: number;
  win: import('../simulation/types').Estimate; reach: import('../simulation/types').Estimate;
  loss: number; encounters: number; generatedAt: number; context: string;
}
export interface TrackerLog { time: number; text: string; }
