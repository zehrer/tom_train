import { useState } from "react";
import { addPoint, deletePoint, loadPreset, MAX_WAGONS, raise, setCamera, setMode, setTrackClosed, stepSpeed, stepWagons, toggleRunning, toggleStationAtSelection, useStore } from "../model/store";
import { MIN_POINTS, minPoints, PRESETS } from "../model/track";
import { enterFullscreen } from "./actions";

type Item = "-" | { heading: string } | { label: string; shortcut?: string; disabled?: boolean; action: () => void };

const check = (on: boolean, label: string) => `${on ? "✓ " : " "}${label}`;

export function Header() {
  const [open, setOpen] = useState<number | null>(null);
  const s = useStore();
  const editor = s.mode === "editor";

  const menus: { label: string; items: Item[] }[] = [
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
        { heading: "Start from a template" },
        ...PRESETS.map((p) => ({
          label: `${p.name}…`,
          action: () => confirm(`Replace the current track with "${p.name}"?`) && loadPreset(p.id),
        })),
        "-",
        { label: "Add point", shortcut: "A", disabled: !editor, action: addPoint },
        { label: "Delete point", shortcut: "⌫", disabled: !editor || s.selected === null || s.track.points.length <= minPoints(s.track), action: deletePoint },
        { label: "Raise point", shortcut: "PgUp", disabled: !editor || s.selected === null, action: () => raise(0.5) },
        { label: "Lower point", shortcut: "PgDn", disabled: !editor || s.selected === null, action: () => raise(-0.5) },
        { label: "Station at point", shortcut: "T", disabled: !editor || s.selected === null, action: toggleStationAtSelection },
        "-",
        { label: check(s.track.closed, "Loop"), disabled: s.track.points.length < MIN_POINTS, action: () => setTrackClosed(true) },
        { label: check(!s.track.closed, "Line (train shuttles)"), action: () => setTrackClosed(false) },
      ],
    },
    {
      label: "Train",
      items: [
        { label: s.running ? "Stop" : "Start", shortcut: "Space", disabled: editor, action: toggleRunning },
        { label: "Faster", shortcut: "↑", disabled: editor, action: () => stepSpeed(1) },
        { label: "Slower", shortcut: "↓", disabled: editor, action: () => stepSpeed(-1) },
        "-",
        { label: "Add wagon", shortcut: "+", disabled: s.wagons >= MAX_WAGONS, action: () => stepWagons(1) },
        { label: "Remove wagon", shortcut: "−", disabled: s.wagons <= 0, action: () => stepWagons(-1) },
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
        { label: "About tom_train", action: () => useStore.setState({ dialog: "about" }) },
      ],
    },
  ];

  return (
    <header className="header">
      <Logo />
      <div className="title-block">
        <div className="title-row">
          <span className="title">tom_train</span>
          <span className="subtitle">{editor ? "Track editor" : "Simulator"}</span>
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
