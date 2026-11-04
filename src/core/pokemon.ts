import { DATA as raw, TYPES as labels } from '../data/pokemon.js';
export interface Species { name: string; fr: string; key: string; types: string[]; base?: number }
const data = raw as unknown as { dex: Record<number, Species>; chart: Record<string, Record<string, number>> };
export const TYPES: Record<string, string> = labels;
export const dex = data.dex;
export const pokemonName = (id: number) => dex[id]?.name || `精灵 #${id}`;
export const effectiveness = (types: string[]) => Object.keys(TYPES).map(type => ({ type, label: TYPES[type], value: Math.min(4, types.reduce((v, d) => v * (data.chart[type]?.[d] ?? 1), 1)) }));
