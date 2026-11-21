import { create } from "zustand";
import type { TrackFile } from "./files";
import { loadLibrary, newId, storeLibrary, uniqueName, type SavedTrack } from "./library";
import { isTrainType, TRAIN_TYPES, trainType, type TrainType } from "./trains";
import { connect, extend, moveNode, parseTrack, preset, PRESETS, raiseNode, removeEdge, removeNode, renameStation, split, toggleStation, type PresetId, type Switches, type Track } from "./track";

/** "game" (a small economy) comes later; the rest of the app switches on this value. */
export type Mode = "editor" | "simulator";
export type CameraMode = "cab" | "follow" | "overview";
export type Selection = { kind: "node"; id: number } | { kind: "edge"; index: number } | null;

export const MAX_SPEED = 200;
export const SPEED_STEP = 10;
export const MAX_TRAINS = 20;

export interface TrainSpec {
  id: number;
  type: TrainType;
  wagons: number;
}

export interface State {
  mode: Mode;
  /** Name of the track being worked on. */
  name: string;
  track: Track;
  switches: Switches;
  /** The library entry the track was opened from or saved to; null for a new, unsaved track. */
  libraryId: string | null;
  library: SavedTrack[];
  /** Track and switches as last saved or opened; anything else counts as unsaved changes. */
  savedTrack: Track | null;
  savedSwitches: Switches | null;
  selected: Selection;
  /** While set, the next point chosen is joined to this one. */
  connectFrom: number | null;
  /** Target speed in km/h; each train goes at most as fast as its type allows. */
  speed: number;
  running: boolean;
  trains: TrainSpec[];
  /** The train the cameras, the switch button and the wagon count refer to. */
  active: number;
  /** A short message shown for a few seconds. */
  notice: string | null;
  camera: CameraMode;
  dialog: null | "keys" | "about" | "open";
  /** Live values reported by the simulation for the status display. */
  live: {
    kmh: number;
    distance: number;
    at: string | null;
    next: string | null;
    /** The next switch the train passes from its trunk, where its way can be chosen. */
    nextSwitch: { node: number; diverging: boolean } | null;
    /** Held up by another train. */
    waiting: boolean;
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
    let trains: TrainSpec[] | undefined;
    if (Array.isArray(v.trains)) {
      trains = v.trains
        .filter((t: { type?: unknown }) => t && isTrainType(t.type))
        .slice(0, MAX_TRAINS)
        .map((t: { type: TrainType; wagons?: unknown }, i: number) => ({
          id: i + 1,
          type: t.type,
          wagons: Number.isInteger(t.wagons) ? Math.min(trainType(t.type).maxWagons, Math.max(0, t.wagons as number)) : trainType(t.type).wagons,
        }));
      if (!trains!.length) trains = undefined;
    } else if (Number.isInteger(v.wagons)) {
      trains = [{ id: 1, type: "steam", wagons: Math.min(8, Math.max(0, v.wagons)) }];
    }
    return {
      trains,
      active: trains && Number.isInteger(v.active) ? (trains[v.active]?.id ?? 1) : undefined,
      name: typeof v.name === "string" ? v.name : undefined,
      libraryId: typeof v.libraryId === "string" ? v.libraryId : undefined,
      track: parseTrack(v.track) ?? undefined,
      switches,
      camera: ["cab", "follow", "overview"].includes(v.camera) ? v.camera : undefined,
      speed: Number.isFinite(v.speed) ? Math.min(MAX_SPEED, Math.max(SPEED_STEP, v.speed)) : undefined,
    };
  } catch {
    return {};
  }
}

const saved = typeof localStorage === "undefined" ? {} : load();

const library = typeof localStorage === "undefined" ? [] : loadLibrary();
const startTrack = saved.track ?? preset("network");
const startSwitches = saved.switches ?? {};
const entry = library.find((e) => e.id === saved.libraryId);
// The working track counts as saved if it still matches its library entry.
const unchanged = !!entry && JSON.stringify([entry.track, entry.switches]) === JSON.stringify([startTrack, startSwitches]);

export const useStore = create<State>(() => ({
  mode: "simulator",
  name: saved.name ?? PRESETS[0].name,
  track: startTrack,
  switches: startSwitches,
  libraryId: entry ? entry.id : null,
  library,
  savedTrack: unchanged ? startTrack : null,
  savedSwitches: unchanged ? startSwitches : null,
  selected: null,
  connectFrom: null,
  speed: saved.speed ?? 50,
  running: true,
  trains: saved.trains ?? [{ id: 1, type: "steam", wagons: 4 }],
  active: saved.active ?? 1,
  notice: null,
  camera: saved.camera ?? "cab",
  dialog: null,
  live: { kmh: 0, distance: 0, at: null, next: null, nextSwitch: null, waiting: false },
}));

useStore.subscribe((s, prev) => {
  const keys = ["track", "switches", "trains", "active", "camera", "speed", "name", "libraryId"] as const;
  if (keys.every((k) => s[k] === prev[k])) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        track: s.track,
        switches: s.switches,
        trains: s.trains.map((t) => ({ type: t.type, wagons: t.wagons })),
        active: Math.max(0, s.trains.findIndex((t) => t.id === s.active)),
        camera: s.camera,
        speed: s.speed,
        name: s.name,
        libraryId: s.libraryId,
      }),
    );
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

// --- Trains ----------------------------------------------------------------------------------

/** The train the controls refer to. */
export const activeTrain = (s: State) => s.trains.find((t) => t.id === s.active) ?? s.trains[0];

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function showNotice(notice: string) {
  set({ notice });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => set({ notice: null }), 4000);
}

function updateActive(f: (t: TrainSpec) => TrainSpec) {
  const s = get();
  const a = activeTrain(s);
  set({ trains: s.trains.map((t) => (t === a ? f(t) : t)) });
}

export const stepWagons = (dir: 1 | -1) =>
  updateActive((t) => ({ ...t, wagons: Math.min(trainType(t.type).maxWagons, Math.max(0, t.wagons + dir)) }));

/** A new train of `type` (default: the next type after the last train's), placed by the simulation. */
export function addTrain(type?: TrainType) {
  const s = get();
  if (s.trains.length >= MAX_TRAINS) return showNotice(`At most ${MAX_TRAINS} trains`);
  const last = s.trains[s.trains.length - 1];
  const t = type ?? TRAIN_TYPES[(TRAIN_TYPES.findIndex((x) => x.id === last?.type) + 1) % TRAIN_TYPES.length].id;
  const id = Math.max(0, ...s.trains.map((x) => x.id)) + 1;
  set({ trains: [...s.trains, { id, type: t, wagons: trainType(t).wagons }], active: id });
}

/** Removes the active train (the last one stays). */
export function removeTrain() {
  const s = get();
  if (s.trains.length <= 1) return;
  const i = s.trains.findIndex((t) => t.id === s.active);
  const trains = s.trains.filter((t) => t.id !== s.active);
  set({ trains, active: trains[Math.min(Math.max(0, i), trains.length - 1)].id });
}

/** The simulation found no room for these trains. */
export function dropTrains(ids: number[]) {
  const s = get();
  const trains = s.trains.filter((t) => !ids.includes(t.id));
  if (!trains.length) return;
  set({ trains, active: trains.some((t) => t.id === s.active) ? s.active : trains[trains.length - 1].id });
  showNotice("No free place on the track for another train");
}

export const selectTrain = (id: number) => set({ active: id });

export function cycleTrain(dir: 1 | -1) {
  const s = get();
  const i = s.trains.findIndex((t) => t.id === s.active);
  set({ active: s.trains[(i + dir + s.trains.length) % s.trains.length].id });
}

export function setTrainType(type: TrainType) {
  updateActive((t) => (t.type === type ? t : { ...t, type, wagons: trainType(type).wagons }));
}

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

// --- Files and library -----------------------------------------------------------------------

export const isDirty = (s: State) => s.track !== s.savedTrack || s.switches !== s.savedSwitches;

const fresh = { selected: null, connectFrom: null } as const;

/** Starts a new, unsaved track from a template. */
export function newFromPreset(id: PresetId) {
  set({ ...fresh, track: preset(id), switches: {}, name: PRESETS.find((p) => p.id === id)!.name, libraryId: null, savedTrack: null, savedSwitches: null });
}

export const renameTrack = (name: string) => set({ name });

function putLibrary(list: SavedTrack[]) {
  if (!storeLibrary(list)) throw new Error("The browser refused to save (storage full or blocked).");
  set({ library: list });
}

/** Saves to the track's library entry, or as a new entry when it has none. */
export function saveTrack() {
  const s = get();
  if (!s.libraryId || !s.library.some((e) => e.id === s.libraryId)) return saveTrackAs(s.name);
  const name = uniqueName(s.library, s.name, s.libraryId);
  putLibrary(s.library.map((e) => (e.id === s.libraryId ? { ...e, name, track: s.track, switches: s.switches, saved: new Date().toISOString() } : e)));
  set({ name, savedTrack: s.track, savedSwitches: s.switches });
}

/** Saves as a new library entry under `name` (numbered if the name is taken). */
export function saveTrackAs(name: string) {
  const s = get();
  const entry: SavedTrack = { id: newId(), name: uniqueName(s.library, name), track: s.track, switches: s.switches, saved: new Date().toISOString() };
  putLibrary([...s.library, entry]);
  set({ name: entry.name, libraryId: entry.id, savedTrack: s.track, savedSwitches: s.switches });
}

export function openSaved(id: string) {
  const e = get().library.find((x) => x.id === id);
  if (!e) return;
  set({ ...fresh, name: e.name, track: e.track, switches: e.switches, libraryId: e.id, savedTrack: e.track, savedSwitches: e.switches, dialog: null });
}

export function deleteSaved(id: string) {
  const s = get();
  putLibrary(s.library.filter((e) => e.id !== id));
  // The open track stays; it just isn't saved anywhere any more.
  if (s.libraryId === id) set({ libraryId: null, savedTrack: null, savedSwitches: null });
}

/** Adds an imported track to the library and opens it. */
export function importTrack(file: TrackFile) {
  const s = get();
  const entry: SavedTrack = { id: newId(), name: uniqueName(s.library, file.name), track: file.track, switches: file.switches, saved: new Date().toISOString() };
  putLibrary([...s.library, entry]);
  openSaved(entry.id);
}

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
