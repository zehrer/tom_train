import { useEffect, useState } from "react";
import {
  addTrack, deleteSelected, isDirty, MAX_SPEED, renameTrack, setCamera, setMode, SPEED_STEP, startConnect, stepSpeed, toggleRunning,
  useStore, type CameraMode,
} from "../model/store";
import { degree, MAX_DEGREE } from "../model/track";
import { Logo, useMenus } from "./Header";
import { EditorBar, SimulatorBar } from "./Toolbar";

/** Phones: narrow, or held sideways (low). */
const PHONE_QUERY = "(max-width: 640px), (max-height: 500px) and (pointer: coarse)";

export function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** One slim row: logo, track name, mode, menu. */
export function PhoneHeader() {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const editor = s.mode === "editor";
  return (
    <header className="phone-header">
      <Logo />
      <input className="title" value={s.name} onChange={(e) => renameTrack(e.target.value)} aria-label="Track name" placeholder="Untitled track" />
      {isDirty(s) && <span className="dirty-dot" title="Not saved" />}
      <div className="segmented mode-switch" role="tablist" aria-label="Mode">
        <button className={editor ? "on" : ""} onClick={() => setMode("editor")} aria-label="Editor">✎</button>
        <button className={!editor ? "on" : ""} onClick={() => setMode("simulator")} aria-label="Simulator">▶</button>
      </div>
      <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu">☰</button>
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
    </header>
  );
}

/** All menus as one scrolling list. */
function MenuSheet({ onClose }: { onClose: () => void }) {
  const menus = useMenus();
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="menu-sheet" onClick={(e) => e.stopPropagation()} role="menu">
        <div className="sheet-head">
          <b>Menu</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {menus.map((m) => (
          <section key={m.label}>
            <h3>{m.label}</h3>
            {m.items.map((it, k) =>
              it === "-" ? null : "heading" in it ? (
                <div className="menu-heading" key={k}>{it.heading}</div>
              ) : (
                <button key={k} disabled={it.disabled} onClick={() => (onClose(), it.action())}>
                  {it.label.trim()}
                </button>
              ),
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

const CAMERAS: { id: CameraMode; label: string }[] = [
  { id: "cab", label: "Cab" },
  { id: "follow", label: "Follow" },
  { id: "overview", label: "Overview" },
];

/** The few buttons that matter most float over the 3D view; ⋯ opens the full toolbar. */
export function PhoneControls() {
  const s = useStore();
  const [more, setMore] = useState(false);
  const sel = s.selected;
  const node = sel?.kind === "node" ? sel.id : null;
  const deg = node !== null ? degree(s.track, node) : 0;
  const cam = CAMERAS.findIndex((c) => c.id === s.camera);
  return (
    <>
      {more && (
        <div className="phone-panel">
          {s.mode === "editor" ? <EditorBar /> : <SimulatorBar />}
        </div>
      )}
      <div className="phone-controls">
        {s.mode === "simulator" ? (
          <>
            <button className={`play${s.running ? " on" : ""}`} onClick={toggleRunning} aria-label={s.running ? "Stop" : "Start"}>
              {s.running ? "■" : "▶"}
            </button>
            <div className="stepper">
              <button onClick={() => stepSpeed(-1)} disabled={s.speed <= SPEED_STEP} aria-label="Slower">−</button>
              <span className="value">{s.speed}</span>
              <button onClick={() => stepSpeed(1)} disabled={s.speed >= MAX_SPEED} aria-label="Faster">+</button>
            </div>
            <button className="chip" onClick={() => setCamera(CAMERAS[(cam + 1) % CAMERAS.length].id)} title="Change the camera">
              🎥 {CAMERAS[cam]?.label}
            </button>
          </>
        ) : (
          <>
            <button className="chip accent" onClick={addTrack} disabled={!sel || deg >= MAX_DEGREE}>
              {sel?.kind === "edge" ? "+ Point" : deg === 2 ? "+ Branch" : "+ Track"}
            </button>
            <button className={`chip${s.connectFrom !== null ? " on" : ""}`} onClick={startConnect} disabled={node === null || deg >= MAX_DEGREE}>
              Connect
            </button>
            <button className="chip" onClick={deleteSelected} disabled={!sel}>Delete</button>
          </>
        )}
        <button className={`chip more${more ? " on" : ""}`} onClick={() => setMore(!more)} aria-label="More controls" aria-expanded={more}>
          {more ? "✕" : "⋯"}
        </button>
      </div>
    </>
  );
}
