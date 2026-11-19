import {
  addTrack, deleteSelected, MAX_SPEED, MAX_WAGONS, raise, renameSelectedStation, setCamera, SPEED_STEP, startConnect,
  stepSpeed, stepWagons, toggleNextSwitch, toggleRunning, toggleStationAtSelection, toggleSwitch, useStore, type CameraMode,
} from "../model/store";
import { newTrack } from "./files";
import { degree, MAX_DEGREE, MAX_HEIGHT, PRESETS, type PresetId } from "../model/track";

const CAMERAS: { id: CameraMode; label: string; title: string }[] = [
  { id: "cab", label: "Cab", title: "Driver's view (1)" },
  { id: "follow", label: "Follow", title: "Follow the train (2)" },
  { id: "overview", label: "Overview", title: "Overview (3)" },
];

export function SimulatorBar() {
  const s = useStore();
  const sw = s.live.nextSwitch;
  return (
    <div className="toolbar">
      <button className={`play${s.running ? " on" : ""}`} onClick={toggleRunning} title="Start / stop (Space)">
        {s.running ? "■ Stop" : "▶ Start"}
      </button>
      <span className="sep" />
      <span className="label">Speed</span>
      <div className="stepper">
        <button onClick={() => stepSpeed(-1)} disabled={s.speed <= SPEED_STEP} title="Slower (↓)" aria-label="Slower">−</button>
        <span className="value">{s.speed} km/h</span>
        <button onClick={() => stepSpeed(1)} disabled={s.speed >= MAX_SPEED} title="Faster (↑)" aria-label="Faster">+</button>
      </div>
      <span className="sep" />
      <span className="label">Wagons</span>
      <div className="stepper">
        <button onClick={() => stepWagons(-1)} disabled={s.wagons <= 0} title="Remove a wagon (−)" aria-label="Remove a wagon">−</button>
        <span className="value short">{s.wagons}</span>
        <button onClick={() => stepWagons(1)} disabled={s.wagons >= MAX_WAGONS} title="Add a wagon (+)" aria-label="Add a wagon">+</button>
      </div>
      <span className="sep" />
      <button className={`switch-btn${sw?.diverging ? " on" : ""}`} disabled={!sw} onClick={toggleNextSwitch} title="Turn the next switch ahead (W); you can also tap a switch lever">
        ⑂ {sw ? (sw.diverging ? "Turn off" : "Straight on") : "No switch ahead"}
      </button>
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
  const node = sel?.kind === "node" ? s.track.nodes.find((n) => n.id === sel.id) : undefined;
  const deg = node ? degree(s.track, node.id) : 0;
  const station = node ? s.track.stations.find((x) => x.node === node.id) : undefined;
  const isSwitch = deg >= 3;
  const addLabel = sel?.kind === "edge" ? "+ Point" : deg === 2 ? "+ Branch" : "+ Track";
  const addTitle = sel?.kind === "edge" ? "Split this track with a new point (A)" : deg === 2 ? "Branch off here; the point becomes a switch (A)" : "Lay new track from this end (A)";
  return (
    <div className="toolbar">
      <select
        value=""
        onChange={(e) => {
          const p = PRESETS.find((x) => x.id === e.target.value);
          if (p) newTrack(p.id as PresetId);
        }}
        title="Start a new track from a template"
      >
        <option value="" disabled>New from template…</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <span className="sep" />
      <button className="accent" onClick={addTrack} disabled={!sel || (node && deg >= MAX_DEGREE)} title={addTitle}>{addLabel}</button>
      <button className={s.connectFrom !== null ? "on" : ""} onClick={startConnect} disabled={!node || deg >= MAX_DEGREE} title="Join this point to another one: tap Connect, then the other point (C)">
        Connect
      </button>
      <button onClick={deleteSelected} disabled={!sel} title="Delete the selected point or track (⌫)">Delete</button>
      <span className="sep" />
      <span className="label">Height</span>
      <div className="stepper">
        <button onClick={() => raise(-0.5)} disabled={!node || node.y <= 0} title="Lower (PgDn)" aria-label="Lower">−</button>
        <span className="value short">{node ? node.y.toFixed(1) : "–"}</span>
        <button onClick={() => raise(0.5)} disabled={!node || node.y >= MAX_HEIGHT} title="Raise (PgUp)" aria-label="Raise">+</button>
      </div>
      <span className="sep" />
      {isSwitch ? (
        <button className={s.switches[node!.id] ? "on" : ""} onClick={() => toggleSwitch(node!.id)} title="Turn this switch (W)">
          ⑂ {s.switches[node!.id] ? "Turned off" : "Straight"}
        </button>
      ) : (
        <button className={station ? "on" : ""} disabled={!node} onClick={toggleStationAtSelection} title="A station with a town at this point (T)">
          Station
        </button>
      )}
      {station && <input className="name-input" value={station.name} onChange={(e) => renameSelectedStation(e.target.value)} aria-label="Town name" />}
      <span className="spacer" />
    </div>
  );
}
