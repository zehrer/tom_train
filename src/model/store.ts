import { create } from "zustand";
import { insertAfter, movePoint, parseTrack, preset, raisePoint, removePoint, renameStation, setClosed, toggleStation, type PresetId, type Track } from "./track";

/** "game" (a small economy) comes later; the rest of the app switches on this value. */
export type Mode = "editor" | "simulator";
export type CameraMode = "cab" | "follow" | "overview";

export const MAX_SPEED = 120;
export const SPEED_STEP = 10;
export const MAX_WAGONS = 8;

export interface State {
  mode: Mode;
  track: Track;
  /** Selected control point in the editor. */
  selected: number | null;
  /** Target speed in km/h; the train accelerates and brakes towards it. */
  speed: number;
  running: boolean;
  wagons: number;
  camera: CameraMode;
  dialog: null | "keys" | "about";
  /** Live values reported by the simulation for the status display. */
  live: { kmh: number; distance: number; at: string | null; next: string | null };
}

const KEY = "tom_train.v1";

function load(): Partial<State> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v) return {};
    return {
      track: parseTrack(v.track) ?? undefined,
      wagons: Number.isInteger(v.wagons) ? Math.min(MAX_WAGONS, Math.max(0, v.wagons)) : undefined,
      camera: ["cab", "follow", "overview"].includes(v.camera) ? v.camera : undefined,
      speed: Number.isFinite(v.speed) ? Math.min(MAX_SPEED, Math.max(SPEED_STEP, v.speed)) : undefined,
    };
  } catch {
    return {};
  }
}

const saved = typeof localStorage === "undefined" ? {} : load();

export const useStore = create<State>(() => ({
  mode: "simulator",
  track: saved.track ?? preset("line"),
  selected: null,
  speed: saved.speed ?? 50,
  running: true,
  wagons: saved.wagons ?? 4,
  camera: saved.camera ?? "cab",
  dialog: null,
  live: { kmh: 0, distance: 0, at: null, next: null },
}));

useStore.subscribe((s, prev) => {
  if (s.track === prev.track && s.wagons === prev.wagons && s.camera === prev.camera && s.speed === prev.speed) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ track: s.track, wagons: s.wagons, camera: s.camera, speed: s.speed }));
  } catch {
    /* storage unavailable: settings just aren't remembered */
  }
});

const set = useStore.setState;
const get = useStore.getState;

export const setMode = (mode: Mode) => set({ mode, selected: null });
export const setCamera = (camera: CameraMode) => set({ camera });
export const toggleRunning = () => set({ running: !get().running });
export const stepSpeed = (dir: 1 | -1) =>
  set({ speed: Math.min(MAX_SPEED, Math.max(SPEED_STEP, get().speed + dir * SPEED_STEP)), running: true });
export const stepWagons = (dir: 1 | -1) => set({ wagons: Math.min(MAX_WAGONS, Math.max(0, get().wagons + dir)) });

export const select = (selected: number | null) => set({ selected });
export const loadPreset = (id: PresetId) => set({ track: preset(id), selected: null });

export function addPoint() {
  const { track, selected } = get();
  const i = selected ?? track.points.length - 1;
  set({ track: insertAfter(track, i), selected: i + 1 });
}

export function deletePoint() {
  const { track, selected } = get();
  if (selected === null) return;
  const next = removePoint(track, selected);
  if (next !== track) set({ track: next, selected: null });
}

export const dragPoint = (i: number, x: number, z: number) => set({ track: movePoint(get().track, i, x, z) });

export function raise(dy: number) {
  const { track, selected } = get();
  if (selected !== null) set({ track: raisePoint(track, selected, dy) });
}

export function toggleStationAtSelection() {
  const { track, selected } = get();
  if (selected !== null) set({ track: toggleStation(track, selected) });
}

export function renameSelectedStation(name: string) {
  const { track, selected } = get();
  if (selected !== null) set({ track: renameStation(track, selected, name) });
}

export const setTrackClosed = (closed: boolean) => set({ track: setClosed(get().track, closed) });
