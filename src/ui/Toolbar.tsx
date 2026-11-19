import { addPoint, deletePoint, loadPreset, MAX_SPEED, MAX_WAGONS, raise, renameSelectedStation, setCamera, setTrackClosed, SPEED_STEP, stepSpeed, stepWagons, toggleRunning, toggleStationAtSelection, useStore, type CameraMode } from "../model/store";
import { MAX_HEIGHT, MIN_POINTS, minPoints, PRESETS, type PresetId } from "../model/track";

const CAMERAS: { id: CameraMode; label: string; title: string }[] = [
  { id: "cab", label: "Cab", title: "Driver's view (1)" },
  { id: "follow", label: "Follow", title: "Follow the train (2)" },
  { id: "overview", label: "Overview", title: "Overview (3)" },
];

export function SimulatorBar() {
  const s = useStore();
  return (
    <div className="toolbar">
      <button className={`play${s.running ? " on" : ""}`} onClick={toggleRunning} title="Start / stop (Space)">
        {s.running ? "■ Stop" : "▶ Start"}
      </button>
      <span className="sep" />
      <span className="label">Speed</span>
      <div className="stepper">
        <button onClick={() => stepSpeed(-1)} disabled={s.speed <= SPEED_STEP} title="Slower (↓)">−</button>
        <span className="value">{s.speed} km/h</span>
        <button onClick={() => stepSpeed(1)} disabled={s.speed >= MAX_SPEED} title="Faster (↑)">+</button>
      </div>
      <span className="sep" />
      <span className="label">Wagons</span>
      <div className="stepper">
        <button onClick={() => stepWagons(-1)} disabled={s.wagons <= 0} title="Remove a wagon (−)">−</button>
        <span className="value">{s.wagons}</span>
        <button onClick={() => stepWagons(1)} disabled={s.wagons >= MAX_WAGONS} title="Add a wagon (+)">+</button>
      </div>
      <span className="spacer" />
      <div className="segmented">
        {CAMERAS.map((c) => (
          <button key={c.id} className={s.camera === c.id ? "on" : ""} title={c.title} onClick={() => setCamera(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditorBar() {
  const s = useStore();
  const sel = s.selected;
  const height = sel !== null ? s.track.points[sel][1] : null;
  const station = sel !== null ? s.track.stations.find((x) => x.point === sel) : undefined;
  return (
    <div className="toolbar">
      <select
        value=""
        onChange={(e) => {
          const p = PRESETS.find((x) => x.id === e.target.value);
          if (p && confirm(`Replace the current track with "${p.name}"?`)) loadPreset(p.id as PresetId);
        }}
        title="Start from a template"
      >
        <option value="" disabled>Template…</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="segmented" title="A loop, or a line the train shuttles along">
        <button className={s.track.closed ? "on" : ""} disabled={s.track.points.length < MIN_POINTS} onClick={() => setTrackClosed(true)}>Loop</button>
        <button className={!s.track.closed ? "on" : ""} onClick={() => setTrackClosed(false)}>Line</button>
      </div>
      <span className="sep" />
      <button className="accent" onClick={addPoint} title="Add a point after the selected one (A)">+ Point</button>
      <button onClick={deletePoint} disabled={sel === null || s.track.points.length <= minPoints(s.track)} title="Delete the selected point (⌫)">Delete</button>
      <span className="sep" />
      <span className="label">Height</span>
      <div className="stepper">
        <button onClick={() => raise(-0.5)} disabled={height === null || height <= 0} title="Lower (PgDn)">−</button>
        <span className="value">{height === null ? "–" : height.toFixed(1)}</span>
        <button onClick={() => raise(0.5)} disabled={height === null || height >= MAX_HEIGHT} title="Raise (PgUp)">+</button>
      </div>
      <span className="sep" />
      <button className={station ? "on" : ""} disabled={sel === null} onClick={toggleStationAtSelection} title="A station with a town at the selected point (T)">
        Station
      </button>
      {station && (
        <input className="name-input" value={station.name} onChange={(e) => renameSelectedStation(e.target.value)} aria-label="Town name" />
      )}
      <span className="spacer" />
      <span className="sel-info">{sel === null ? "No point selected" : `Point ${sel + 1} of ${s.track.points.length}`}</span>
    </div>
  );
}
