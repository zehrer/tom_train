import { create } from "zustand";
import { connect, extend, moveNode, parseTrack, preset, raiseNode, removeEdge, removeNode, renameStation, split, toggleStation, type PresetId, type Switches, type Track } from "./track";

/** "game" (a small economy) comes later; the rest of the app switches on this value. */
export type Mode = "editor" | "simulator";
export type CameraMode = "cab" | "follow" | "overview";
export type Selection = { kind: "node"; id: number } | { kind: "edge"; index: number } | null;

export const MAX_SPEED = 120;
export const SPEED_STEP = 10;
export const MAX_WAGONS = 8;

export interface State {
  mode: Mode;
  track: Track;
  switches: Switches;
  selected: Selection;
  /** While set, the next point chosen is joined to this one. */
  connectFrom: number | null;
  /** Target speed in km/h; the train accelerates and brakes towards it. */
  speed: number;
  running: boolean;
  wagons: number;
  camera: CameraMode;
  dialog: null | "keys" | "about";
  /** Live values reported by the simulation for the status display. */
  live: {
    kmh: number;
    distance: number;
    at: string | null;
    next: string | null;
    /** The next switch the train passes from its trunk, where its way can be chosen. */
    nextSwitch: { node: number; diverging: boolean } | null;
  };
}

const KEY = "tom_train.v1";

function load(): Partial<State> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v) return {};
    const switches: Switches = {};
    if (v.switches && typeof v.switches === "object") {
      for (const [k, val] of Object.entries(v.switches)) if (val === 0 || val === 1) switches[Number(k)] = val;
    }
    return {
      track: parseTrack(v.track) ?? undefined,
      switches,
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
  track: saved.track ?? preset("network"),
  switches: saved.switches ?? {},
  selected: null,
  connectFrom: null,
  speed: saved.speed ?? 50,
  running: true,
  wagons: saved.wagons ?? 4,
  camera: saved.camera ?? "cab",
  dialog: null,
  live: { kmh: 0, distance: 0, at: null, next: null, nextSwitch: null },
}));

useStore.subscribe((s, prev) => {
  if (s.track === prev.track && s.switches === prev.switches && s.wagons === prev.wagons && s.camera === prev.camera && s.speed === prev.speed) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ track: s.track, switches: s.switches, wagons: s.wagons, camera: s.camera, speed: s.speed }));
  } catch {
    /* storage unavailable: settings just aren't remembered */
  }
});

const set = useStore.setState;
const get = useStore.getState;

export const setMode = (mode: Mode) => set({ mode, selected: null, connectFrom: null });
export const setCamera = (camera: CameraMode) => set({ camera });
export const toggleRunning = () => set({ running: !get().running });
export const stepSpeed = (dir: 1 | -1) =>
  set({ speed: Math.min(MAX_SPEED, Math.max(SPEED_STEP, get().speed + dir * SPEED_STEP)), running: true });
export const stepWagons = (dir: 1 | -1) => set({ wagons: Math.min(MAX_WAGONS, Math.max(0, get().wagons + dir)) });

export function toggleSwitch(node: number) {
  const { switches } = get();
  set({ switches: { ...switches, [node]: switches[node] ? 0 : 1 } });
}

/** Turns the next switch ahead of the train (W). */
export function toggleNextSwitch() {
  const next = get().live.nextSwitch;
  if (next) toggleSwitch(next.node);
}

// --- Editor ----------------------------------------------------------------------------------

const selectedNode = () => {
  const s = get().selected;
  return s?.kind === "node" ? s.id : null;
};

export const loadPreset = (id: PresetId) => set({ track: preset(id), switches: {}, selected: null, connectFrom: null });

/** A tap on a point: selects it, or finishes "connect" by joining the two points. */
export function pickNode(id: number) {
  const { connectFrom, track } = get();
  if (connectFrom !== null && connectFrom !== id) {
    set({ track: connect(track, connectFrom, id), connectFrom: null, selected: { kind: "node", id } });
    return;
  }
  set({ selected: { kind: "node", id }, connectFrom: null });
}

export const pickEdge = (index: number) => set({ selected: { kind: "edge", index }, connectFrom: null });
export const clearSelection = () => set({ selected: null, connectFrom: null });

/** New track from the selected point (extend or branch), or a new point splitting the selected track. */
export function addTrack() {
  const { track, selected } = get();
  if (selected?.kind === "edge") {
    const r = split(track, selected.index);
    set({ track: r.track, selected: { kind: "node", id: r.node } });
  } else if (selected?.kind === "node") {
    const r = extend(track, selected.id);
    if (r.node !== null) set({ track: r.track, selected: { kind: "node", id: r.node } });
  }
}

export function startConnect() {
  const id = selectedNode();
  if (id !== null) set({ connectFrom: get().connectFrom === id ? null : id });
}

export function deleteSelected() {
  const { track, selected } = get();
  if (!selected) return;
  const next = selected.kind === "node" ? removeNode(track, selected.id) : removeEdge(track, selected.index);
  if (next !== track) set({ track: next, selected: null, connectFrom: null });
}

export const dragNode = (id: number, x: number, z: number) => set({ track: moveNode(get().track, id, x, z) });

export function raise(dy: number) {
  const id = selectedNode();
  if (id !== null) set({ track: raiseNode(get().track, id, dy) });
}

export function toggleStationAtSelection() {
  const id = selectedNode();
  if (id !== null) set({ track: toggleStation(get().track, id) });
}

export function renameSelectedStation(name: string) {
  const id = selectedNode();
  if (id !== null) set({ track: renameStation(get().track, id, name) });
}
