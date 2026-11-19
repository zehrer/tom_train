import type { Track, TrackPath } from "./track";

/** World units per km/h of model speed (per second); a lap takes a sensible time. */
export const KMH_TO_UNITS = 0.6 / 3.6;
export const ACCEL = 14; // km/h per second
export const BRAKE = 24;
export const DWELL = 5; // seconds at a station
/** Signals turn green this long before the train leaves. */
export const SIGNAL_LEAD = 1.5;

export interface Stop {
  /** Position of the train's middle when it stands here. */
  s: number;
  name: string | null;
  station: number | null;
}

/**
 * Moves the train along the track: accelerates to the cruise speed, brakes to stop with its middle
 * at each station, waits there, and on a line reverses at the ends (the loco then pushes).
 */
export class Driver {
  /** Position of the middle of the train. */
  mid = 0;
  /** +1: towards growing positions (loco leading), −1: backwards (loco pushing). */
  dir: 1 | -1 = 1;
  kmh = 0;
  dwell = 0;
  /** Stop the train stands at or last left; null while none. */
  at: Stop | null = null;
  stops: Stop[] = [];
  private departing = false;
  private travelled = 0;
  private lo = 0;
  private hi = 0;

  private path!: TrackPath;

  constructor(
    path: TrackPath,
    track: Track,
    private trainLength: number,
  ) {
    this.setTrack(path, track, trainLength);
    this.mid = this.stops[0]?.s ?? this.lo;
    if (this.stops.length) this.arrive(this.stops[0]);
    this.dwell = 1;
  }

  setTrack(path: TrackPath, track: Track, trainLength: number) {
    // Keep the train where it is in the world, not at the same distance along the changed track.
    const here = this.path === path ? null : this.path?.pointAt(this.mid);
    const standing = this.dwell > 0 ? this.at?.station ?? null : null;
    this.path = path;
    this.trainLength = trainLength;
    const L = path.length;
    const margin = trainLength / 2 + 1.5;
    if (path.closed) {
      this.lo = 0;
      this.hi = L;
    } else if (L > 2 * margin) {
      this.lo = margin;
      this.hi = L - margin;
    } else {
      this.lo = this.hi = L / 2;
    }
    const stops: Stop[] = track.stations.map((st, i) => ({
      s: path.closed ? path.pointS[st.point] : Math.min(this.hi, Math.max(this.lo, path.pointS[st.point])),
      name: st.name,
      station: i,
    }));
    if (!path.closed) {
      // The ends of a line are always stops, named when a station is close.
      for (const s of [this.lo, this.hi]) {
        if (!stops.some((x) => Math.abs(x.s - s) < 1)) stops.push({ s, name: null, station: null });
      }
    }
    stops.sort((a, b) => a.s - b.s);
    this.stops = stops;
    if (here) this.mid = path.nearest(here);
    this.mid = path.closed ? path.wrap(this.mid) : Math.min(this.hi, Math.max(this.lo, this.mid));
    // A train standing at a station moves with it; otherwise it no longer stands anywhere.
    const same = standing !== null ? stops.find((x) => x.station === standing && x.name === this.at?.name) : undefined;
    if (same) {
      this.mid = same.s;
      this.at = same;
    } else {
      this.at = null;
      this.dwell = 0;
    }
  }

  /** Position of the loco's center for a loco of the given length at the front (towards +s). */
  locoS(locoLength: number) {
    return this.mid + this.trainLength / 2 - locoLength / 2;
  }

  /** The next stop ahead and the distance to it. */
  next(): { stop: Stop; d: number } | null {
    let best: { stop: Stop; d: number } | null = null;
    const L = this.path.length;
    for (const stop of this.stops) {
      let d = (stop.s - this.mid) * this.dir;
      if (this.path.closed) d = ((d % L) + L) % L;
      if (d < 0 || (this.departing && d < 0.5)) continue;
      if (!best || d < best.d) best = { stop, d };
    }
    return best;
  }

  private arrive(stop: Stop) {
    this.mid = stop.s;
    this.kmh = 0;
    this.dwell = DWELL;
    this.at = stop;
    this.departing = false;
    // At the end of a line the train will leave the other way; signals and the cab follow at once.
    if (!this.path.closed) {
      if (stop.s >= this.hi - 0.01) this.dir = -1;
      else if (stop.s <= this.lo + 0.01) this.dir = 1;
    }
  }

  /** Whether the train is about to leave (or moving): the exit signal shows green. */
  get clear() {
    return this.dwell <= SIGNAL_LEAD;
  }

  /** Advances by dt seconds; cruise = 0 stops the train where it is. Returns the distance moved. */
  update(dt: number, cruise: number) {
    if (this.dwell > 0) {
      if (cruise <= 0) return 0; // the clock waits while stopped by hand
      this.dwell -= dt;
      if (this.dwell > 0) return 0;
      this.dwell = 0;
      this.departing = true;
      this.travelled = 0;
    }

    const ahead = this.next();
    let target = cruise;
    if (ahead) {
      // Fastest speed that still lets the train stop at the next stop; a small floor makes it arrive.
      const allowed = Math.sqrt(2 * BRAKE * KMH_TO_UNITS * ahead.d) / KMH_TO_UNITS;
      target = Math.min(cruise, Math.max(allowed, cruise > 0 ? 3 : 0));
    }
    this.kmh = this.kmh < target ? Math.min(target, this.kmh + ACCEL * dt) : Math.max(target, this.kmh - BRAKE * 1.5 * dt);

    const step = this.kmh * KMH_TO_UNITS * dt;
    if (ahead && !this.departing && step >= ahead.d - 0.02) {
      const moved = ahead.d * this.dir;
      this.arrive(ahead.stop);
      return moved;
    }
    const before = this.mid;
    this.mid += step * this.dir;
    if (this.path.closed) this.mid = this.path.wrap(this.mid);
    else this.mid = Math.min(this.hi, Math.max(this.lo, this.mid));
    this.travelled += step;
    if (this.travelled > 0.5) this.departing = false;
    return this.path.closed ? step * this.dir : this.mid - before;
  }
}
