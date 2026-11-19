import { parseTrack, type Switches, type Track } from "./track";

/** A track saved in the browser's library. */
export interface SavedTrack {
  id: string;
  name: string;
  track: Track;
  switches: Switches;
  /** ISO time of the last save. */
  saved: string;
}

const KEY = "tom_train.library.v1";

export function loadLibrary(): SavedTrack[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((e) => {
      const track = parseTrack(e?.track);
      if (!track || typeof e.id !== "string" || typeof e.name !== "string") return [];
      return [{ id: e.id, name: e.name, track, switches: e.switches && typeof e.switches === "object" ? e.switches : {}, saved: String(e.saved ?? "") }];
    });
  } catch {
    return [];
  }
}

/** Writes the library; returns false if the browser refused (storage full or blocked). */
export function storeLibrary(list: SavedTrack[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** `name`, or "name (2)", "name (3)", … if another saved track already has it. */
export function uniqueName(list: SavedTrack[], name: string, exceptId?: string) {
  const base = name.trim() || "Untitled track";
  const taken = new Set(list.filter((e) => e.id !== exceptId).map((e) => e.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
