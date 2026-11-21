import { useState } from "react";
import { activeTrain, addTrain, cycleTrain, MAX_TRAINS, removeTrain } from "../model/store";
import { TRAIN_TYPES, trainType } from "../model/trains";
import { addTrack, deleteSelected, isDirty, renameTrack, raise, setCamera, setMode, startConnect, stepSpeed, stepWagons, toggleNextSwitch, toggleRunning, toggleStationAtSelection, useStore } from "../model/store";
import { PRESETS } from "../model/track";
import { enterFullscreen, MOD } from "./actions";
import { exportHTML, importFromPicker, newTrack, save, saveAs, showOpen } from "./files";

export const LIVE_URL = "https://zehrer.github.io/tom_train/";
export const REPO_URL = "https://github.com/zehrer/tom_train";

export type Item = "-" | { heading: string } | { label: string; shortcut?: string; disabled?: boolean; action: () => void };

const check = (on: boolean, label: string) => `${on ? "✓ " : " "}${label}`;

export type Menu = { label: string; items: Item[] };

/** The menus, shared by the desktop menu bar and the phone menu sheet. */
export function useMenus(): Menu[] {
  const s = useStore();
  const editor = s.mode === "editor";
  return [
    {
      label: "File",
      items: [
        { heading: "New track from a template" },
        ...PRESETS.map((p) => ({ label: `\u2003${p.name}`, action: () => newTrack(p.id) })),
        "-",
        { label: "Open…", shortcut: `${MOD}O`, action: showOpen },
        { label: "Save", shortcut: `${MOD}S`, action: save },
        { label: "Save as…", action: saveAs },
        "-",
        { label: "Export as HTML (map + track, opens in any browser)", action: exportHTML },
        { label: "Import (HTML or JSON)…", action: importFromPicker },
      ],
    },
    {
      label: "Mode",
      items: [
        { label: check(editor, "Editor"), shortcut: "E", action: () => setMode("editor") },
        { label: check(!editor, "Simulator"), shortcut: "S", action: () => setMode("simulator") },
        { label: " Game (coming later)", disabled: true, action: () => {} },
      ],
    },
    {
      label: "Track",
      items: [
        { label: "New track / split track", shortcut: "A", disabled: !editor || !s.selected, action: addTrack },
        { label: "Connect to another point", shortcut: "C", disabled: !editor || s.selected?.kind !== "node", action: startConnect },
        { label: "Delete", shortcut: "⌫", disabled: !editor || !s.selected, action: deleteSelected },
        { label: "Raise point", shortcut: "PgUp", disabled: !editor || s.selected?.kind !== "node", action: () => raise(0.5) },
        { label: "Lower point", shortcut: "PgDn", disabled: !editor || s.selected?.kind !== "node", action: () => raise(-0.5) },
        { label: "Station at point", shortcut: "T", disabled: !editor || s.selected?.kind !== "node", action: toggleStationAtSelection },
      ],
    },
    {
      label: "Train",
      items: [
        { label: s.running ? "Stop" : "Start", shortcut: "Space", disabled: editor, action: toggleRunning },
        { label: "Faster", shortcut: "↑", disabled: editor, action: () => stepSpeed(1) },
        { label: "Slower", shortcut: "↓", disabled: editor, action: () => stepSpeed(-1) },
        { label: "Turn the next switch", shortcut: "W", disabled: editor || !s.live.nextSwitch, action: toggleNextSwitch },
        "-",
        { label: "Add wagon", shortcut: "+", disabled: activeTrain(s).wagons >= trainType(activeTrain(s).type).maxWagons, action: () => stepWagons(1) },
        { label: "Remove wagon", shortcut: "−", disabled: activeTrain(s).wagons <= 0, action: () => stepWagons(-1) },
        "-",
        { heading: `Add a train (${s.trains.length} of ${MAX_TRAINS})` },
        ...TRAIN_TYPES.map((t) => ({ label: `\u2003${t.name} · ${t.maxKmh} km/h`, disabled: s.trains.length >= MAX_TRAINS, action: () => addTrain(t.id) })),
        { label: "Next train", shortcut: "N", disabled: s.trains.length < 2, action: () => cycleTrain(1) },
        { label: "Remove this train", disabled: s.trains.length < 2, action: removeTrain },
      ],
    },
    {
      label: "View",
      items: [
        { heading: "Simulator camera" },
        { label: check(s.camera === "cab", "Cab (driver's view)"), shortcut: "1", action: () => (setMode("simulator"), setCamera("cab")) },
        { label: check(s.camera === "follow", "Follow the train"), shortcut: "2", action: () => (setMode("simulator"), setCamera("follow")) },
        { label: check(s.camera === "overview", "Overview"), shortcut: "3", action: () => (setMode("simulator"), setCamera("overview")) },
        "-",
        { label: "Full screen", action: enterFullscreen },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard shortcuts", shortcut: "?", action: () => useStore.setState({ dialog: "keys" }) },
        { label: "Open the live app", action: () => window.open(LIVE_URL, "_blank", "noopener") },
        { label: "Source code on GitHub", action: () => window.open(REPO_URL, "_blank", "noopener") },
        "-",
        { label: "About tom_train", action: () => useStore.setState({ dialog: "about" }) },
      ],
    },
  ];
}

export function Header() {
  const [open, setOpen] = useState<number | null>(null);
  const s = useStore();
  const editor = s.mode === "editor";
  const menus = useMenus();

  return (
    <header className="header">
      <Logo />
      <div className="title-block">
        <div className="title-row">
          <input className="title" value={s.name} onChange={(e) => renameTrack(e.target.value)} aria-label="Track name" placeholder="Untitled track" />
          <span className="subtitle">{editor ? "Track editor" : "Simulator"}</span>
          <span className="save-status">{isDirty(s) ? (s.libraryId ? "Unsaved changes" : "Not saved") : "Saved"}</span>
        </div>
        <nav className="menubar">
          {menus.map((m, i) => (
            <div className="menu-anchor" key={m.label}>
              <button className={open === i ? "open" : ""} onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
                {m.label}
              </button>
              {open === i && (
                <div className="menu" role="menu">
                  {m.items.map((it, k) =>
                    it === "-" ? (
                      <hr key={k} />
                    ) : "heading" in it ? (
                      <div className="menu-heading" key={k}>{it.heading}</div>
                    ) : (
                      <button key={k} disabled={it.disabled} onClick={() => (setOpen(null), it.action())}>
                        <span>{it.label}</span>
                        {it.shortcut && <kbd>{it.shortcut}</kbd>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div className="segmented mode-switch" role="tablist" aria-label="Mode">
        <button className={editor ? "on" : ""} onClick={() => setMode("editor")}>Editor</button>
        <button className={!editor ? "on" : ""} onClick={() => setMode("simulator")}>Simulator</button>
      </div>
      {open !== null && <div className="backdrop" onClick={() => setOpen(null)} />}
    </header>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0b57d0" />
      <rect x="7" y="8" width="18" height="13" rx="3" fill="white" />
      <rect x="10" y="11" width="5" height="4" rx="1" fill="#0b57d0" />
      <rect x="17" y="11" width="5" height="4" rx="1" fill="#0b57d0" />
      <circle cx="11" cy="24" r="2" fill="white" />
      <circle cx="21" cy="24" r="2" fill="white" />
    </svg>
  );
}
