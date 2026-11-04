export type HuntKind = 'roaming' | 'zone' | 'weather';
export interface Destination {
  chapter: number; region: string; name: string; zone?: number;
  until?: number; weather?: string; chance?: number; habitats?: string[];
  staticId?: number;
}
export interface HuntTarget {
  id: number; name: string; kind: HuntKind; owned: boolean; status: string;
  destinations: Destination[];
}
export interface HuntBerry { key: string; name: string; family: string; mult: number; minutes: number; stock: number; }
export interface HuntCatalog { now: number; targets: HuntTarget[]; chapter: number; team: string[]; berries?: HuntBerry[]; }
export interface HuntJob { id: number; kind: HuntKind; destination: Destination; interrupt: boolean; }
export interface TrackerPrefs { targets: number[]; mode: 'interrupt' | 'ordered'; weather: number[] | null; berries: string[]; }
export interface TrackerLog { time: number; text: string; }
