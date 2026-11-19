import { useMemo } from "react";
import { useStore } from "../model/store";
import { TrackPath } from "../model/track";

export function Status() {
  const mode = useStore((s) => s.mode);
  const track = useStore((s) => s.track);
  const selected = useStore((s) => s.selected);
  const kmh = useStore((s) => s.live.kmh);
  const km = useStore((s) => s.live.distance);
  const at = useStore((s) => s.live.at);
  const next = useStore((s) => s.live.next);
  const info = useMemo(() => {
    const p = new TrackPath(track);
    return { length: p.length, conflicts: p.conflicts(1.5).length };
  }, [track]);

  if (mode === "editor") {
    const pt = selected !== null ? track.points[selected] : null;
    return (
      <div className="status">
        <span>{track.closed ? "Loop" : "Line"} · {track.points.length} points · {track.stations.length} towns · {Math.round(info.length / 0.6)} m</span>
        {pt && <span>Point {selected! + 1}: height {pt[1].toFixed(1)}</span>}
        {info.conflicts > 0 ? (
          <span className="warn">Tracks cross without enough height: raise one of them</span>
        ) : (
          <span className="hint">Drag the blue points · click a point to select it</span>
        )}
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
