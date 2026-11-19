import { save, showOpen } from "./files";
import { addTrack, clearSelection, deleteSelected, raise, setCamera, setMode, startConnect, stepSpeed, stepWagons, toggleNextSwitch, toggleRunning, toggleStationAtSelection, toggleSwitch, useStore } from "../model/store";

export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function enterFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Keyboard shortcuts; the same table feeds the Help dialog. */
export const SHORTCUTS: { keys: string; label: string; mode?: "editor" | "simulator" }[] = [
  { keys: "E", label: "Editor mode" },
  { keys: "S", label: "Simulator mode" },
  { keys: "Space", label: "Start / stop the train", mode: "simulator" },
  { keys: "↑ / ↓", label: "Faster / slower", mode: "simulator" },
  { keys: "W", label: "Turn the next switch ahead", mode: "simulator" },
  { keys: "1 / 2 / 3", label: "Cab / follow / overview camera", mode: "simulator" },
  { keys: "+ / −", label: "Add / remove a wagon", mode: "simulator" },
  { keys: "A", label: "New track from the selected point, or split the selected track", mode: "editor" },
  { keys: "C", label: "Connect the selected point to another one", mode: "editor" },
  { keys: "W", label: "Turn the selected switch", mode: "editor" },
  { keys: "T", label: "Station with a town at the selected point", mode: "editor" },
  { keys: "⌫", label: "Delete the selected point or track", mode: "editor" },
  { keys: "PgUp / PgDn", label: "Raise / lower the selected point", mode: "editor" },
  { keys: "Esc", label: "Clear the selection", mode: "editor" },
  { keys: `${MOD}S / ${MOD}O`, label: "Save / open a saved track" },
  { keys: "?", label: "Keyboard shortcuts" },
];

export function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "o")) {
    e.preventDefault();
    return e.key === "s" ? save() : showOpen();
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  const s = useStore.getState();
  if (s.dialog) {
    if (e.key === "Escape") useStore.setState({ dialog: null });
    return;
  }
  const k = e.key;
  const run = (f: () => void) => (e.preventDefault(), f());
  if (k === "e" || k === "E") return run(() => setMode("editor"));
  if (k === "s" || k === "S") return run(() => setMode("simulator"));
  if (k === "?") return run(() => useStore.setState({ dialog: "keys" }));
  if (s.mode === "simulator") {
    if (k === " ") return run(toggleRunning);
    if (k === "ArrowUp") return run(() => stepSpeed(1));
    if (k === "ArrowDown") return run(() => stepSpeed(-1));
    if (k === "1") return run(() => setCamera("cab"));
    if (k === "2") return run(() => setCamera("follow"));
    if (k === "3") return run(() => setCamera("overview"));
    if (k === "+" || k === "=") return run(() => stepWagons(1));
    if (k === "-") return run(() => stepWagons(-1));
    if (k === "w" || k === "W") return run(toggleNextSwitch);
  } else {
    if (k === "a" || k === "A") return run(addTrack);
    if (k === "c" || k === "C") return run(startConnect);
    if (k === "w" || k === "W") return run(() => s.selected?.kind === "node" && toggleSwitch(s.selected.id));
    if (k === "Backspace" || k === "Delete") return run(deleteSelected);
    if (k === "t" || k === "T") return run(toggleStationAtSelection);
    if (k === "PageUp") return run(() => raise(0.5));
    if (k === "PageDown") return run(() => raise(-0.5));
    if (k === "Escape") return run(clearSelection);
  }
}
