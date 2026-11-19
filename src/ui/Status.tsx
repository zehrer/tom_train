import { useMemo } from "react";
import { degree, TrackGraph } from "../model/track";
import { useStore } from "../model/store";

const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function Status() {
  const mode = useStore((s) => s.mode);
  const track = useStore((s) => s.track);
  const selected = useStore((s) => s.selected);
  const connectFrom = useStore((s) => s.connectFrom);
  const kmh = useStore((s) => s.live.kmh);
  const km = useStore((s) => s.live.distance);
  const at = useStore((s) => s.live.at);
  const next = useStore((s) => s.live.next);
  const info = useMemo(() => {
    const g = new TrackGraph(track);
    return {
      length: g.length,
      conflicts: g.conflicts().length,
      switches: [...g.nodes.values()].filter((n) => n.branches).length,
    };
  }, [track]);

  if (mode === "editor") {
    const tap = touch ? "Tap" : "Click";
    let hint = `Drag the points · ${tap.toLowerCase()} a point or a track to select it`;
    if (connectFrom !== null) hint = `${tap} the point to connect to`;
    else if (selected?.kind === "edge") hint = "+ Point splits this track · Delete removes it";
    else if (selected?.kind === "node") {
      const d = degree(track, selected.id);
      hint = d >= 3 ? `A switch · ${tap.toLowerCase()} its lever or press the switch button to turn it` : d === 2 ? "+ Branch lays a new track and makes a switch here" : "+ Track lays new track from this end";
    }
    return (
      <div className="status">
        <span>{track.nodes.length} points · {info.switches} switches · {track.stations.length} towns · {Math.round(info.length / 0.6)} m</span>
        {info.conflicts > 0 ? <span className="warn">Tracks cross without enough height: raise one of them</span> : <span className="hint">{hint}</span>}
      </div>
    );
  }
  return (
    <div className="status">
      <span className="speedo"><b>{kmh}</b> km/h</span>
      <span>{km.toFixed(2)} km</span>
      {at ? <span className="stop">At <b>{at}</b></span> : next && <span className="stop">Next stop: <b>{next}</b></span>}
    </div>
  );
}
