// The one seam between race data and the app (see DATA.md § Data sources).
//
// A RaceSource is { name, load(): Promise<RaceV1> }. Everything after load()
// — validation, the race model, the renderer and the HUD — only sees the
// version-1 contract, so a GPX/FIT importer or a live per-rider feed plugs in
// here by producing the same shape. Nothing else changes.
import { validateRace } from '../race.js';

export function jsonSource(url = '/api/race') {
  return {
    name: 'json',
    async load() {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Race data unavailable (${response.status}).`);
      return response.json();
    },
  };
}

// The simulated demo race served by api/race.js from data/race.json.
export const simulatedSource = () => jsonSource('/api/race');

export async function loadRace(source = simulatedSource()) {
  return validateRace(await source.load());
}
