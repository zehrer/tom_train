import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";

/** A control point of the track: x and z on the ground, y = height of the track bed above it. */
export type Point = [x: number, y: number, z: number];

/** A station sits at a control point; a town grows around it. */
export interface Station {
  point: number;
  name: string;
}

export interface Track {
  points: Point[];
  /** true: a loop; false: a line with two ends the train shuttles between. */
  closed: boolean;
  stations: Station[];
}

export const MIN_POINTS = 4;
export const MIN_LINE_POINTS = 2;
export const MAX_HEIGHT = 8;
/** Height difference between two crossing tracks that a train fits through. */
export const CLEARANCE = 3.6;

export const TOWN_NAMES = [
  "Lindenberg", "Mühlbach", "Eichstadt", "Rosenhain", "Birkenau", "Tannfeld", "Weidental", "Ahornhausen",
  "Erlenbrück", "Buchwald", "Kirschdorf", "Steinach",
];

export type PresetId = "oval" | "eight" | "hills" | "line";

export const PRESETS: { id: PresetId; name: string }[] = [
  { id: "line", name: "Line with towns" },
  { id: "oval", name: "Oval" },
  { id: "eight", name: "Figure eight" },
  { id: "hills", name: "Hills" },
];

const r1 = (n: number) => Math.round(n * 10) / 10 + 0; // + 0 turns -0 into 0

function sample(n: number, fn: (t: number) => Point): Point[] {
  return Array.from({ length: n }, (_, i) => fn((i / n) * Math.PI * 2).map(r1) as Point);
}

const loop = (points: Point[], station: number): Track => ({ points, closed: true, stations: [{ point: station, name: TOWN_NAMES[0] }] });

export function preset(id: PresetId): Track {
  switch (id) {
    case "oval": {
      // A stadium: two straights joined by half circles, sampled evenly along its length.
      const straight = 44, radius = 20, half = straight / 2;
      const total = 2 * straight + 2 * Math.PI * radius;
      return loop(
        sample(16, (t) => {
          let s = (t / (Math.PI * 2)) * total;
          if (s < half) return [s, 0, radius];
          s -= half;
          if (s < Math.PI * radius) { const a = s / radius; return [half + radius * Math.sin(a), 0, radius * Math.cos(a)]; }
          s -= Math.PI * radius;
          if (s < straight) return [half - s, 0, -radius];
          s -= straight;
          if (s < Math.PI * radius) { const a = s / radius; return [-half - radius * Math.sin(a), 0, -radius * Math.cos(a)]; }
          s -= Math.PI * radius;
          return [-half + s, 0, radius];
        }),
        0,
      );
    }
    case "eight": {
      // Lemniscate of Gerono; the track climbs over itself at t = 0 and passes below at t = π.
      const a = 36, h = 4.4;
      return loop(sample(20, (t) => [a * Math.sin(t), h * ((1 + Math.cos(t)) / 2) ** 2, a * Math.sin(t) * Math.cos(t)]), 12);
    }
    case "hills":
      return loop(
        sample(18, (t) => {
          const r = 34 + 7 * Math.sin(3 * t);
          return [1.2 * r * Math.cos(t), 2.2 * (1 - Math.cos(2 * t)), r * Math.sin(t)];
        }),
        0,
      );
    case "line":
      return {
        closed: false,
        points: [
          [-140, 0, 0], [-120, 0, 4], [-100, 1, 14], [-80, 2, 22], [-62, 0.5, 18], [-44, 0, 8], [-26, 0, -2],
          [-8, 1.5, -14], [12, 3, -24], [32, 1.5, -20], [52, 0, -8], [70, 0, 4], [90, 1, 14], [112, 0.5, 12], [140, 0, 4],
        ],
        stations: [0, 5, 10, 14].map((point, i) => ({ point, name: TOWN_NAMES[i] })),
      };
  }
}

/** The geometry derived from the control points; positions along it are arc lengths. */
export class TrackPath {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  readonly closed: boolean;
  /** Arc length of every control point. */
  readonly pointS: number[];

  constructor(track: Track) {
    const pts = track.points.map(([x, y, z]) => new Vector3(x, y, z));
    this.closed = track.closed;
    this.curve = new CatmullRomCurve3(pts, track.closed, "centripetal");
    const div = Math.max(400, pts.length * 40);
    this.curve.arcLengthDivisions = div;
    this.length = this.curve.getLength();
    const lengths = this.curve.getLengths(div);
    const segs = track.closed ? pts.length : pts.length - 1;
    this.pointS = pts.map((_, i) => lengths[Math.round((i / segs) * div)]);
  }

  /** Wraps a position on a loop, clamps it on a line. */
  wrap(s: number) {
    const L = this.length;
    return this.closed ? ((s % L) + L) % L : Math.min(L, Math.max(0, s));
  }

  private u(s: number) {
    return this.wrap(s) / this.length;
  }

  pointAt(s: number, target = new Vector3()) {
    if (!this.closed && (s < 0 || s > this.length)) {
      // Past the ends of a line: continue straight so vehicles never fold up.
      const end = s < 0 ? 0 : this.length;
      const t = this.curve.getTangentAt(end / this.length);
      return this.curve.getPointAt(end / this.length, target).addScaledVector(t, s - end);
    }
    return this.curve.getPointAt(this.u(s), target);
  }

  tangentAt(s: number, target = new Vector3()) {
    return this.curve.getTangentAt(this.u(s), target);
  }

  /**
   * Pose of a vehicle whose bogies run at s ± half: centered between them and pointing from the
   * rear bogie to the front one, so it follows curves and slopes like a real car.
   */
  vehiclePose(s: number, half: number, position = new Vector3(), quaternion = new Quaternion()) {
    const front = this.pointAt(s + half);
    const back = this.pointAt(s - half);
    position.copy(front).add(back).multiplyScalar(0.5);
    const z = front.sub(back).normalize();
    const x = new Vector3(0, 1, 0).cross(z).normalize();
    const y = new Vector3().crossVectors(z, x);
    quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    return { position, quaternion };
  }

  /** Arc length of the track position closest to p (in 3D, so bridges and the track below differ). */
  nearest(p: Vector3) {
    const coarse = this.samples(2);
    let best = coarse[0].s, bestD = Infinity;
    for (const { s, p: q } of coarse) {
      const d = q.distanceToSquared(p);
      if (d < bestD) (bestD = d), (best = s);
    }
    // Refine around the best sample.
    const v = new Vector3();
    for (let s = best - 2; s <= best + 2; s += 0.05) {
      if (!this.closed && (s < 0 || s > this.length)) continue;
      const d = this.pointAt(s, v).distanceToSquared(p);
      if (d < bestD) (bestD = d), (best = s);
    }
    return this.wrap(best);
  }

  /** Evenly spaced samples; a line includes both ends. */
  samples(step: number) {
    const n = Math.max(8, Math.round(this.length / step));
    const count = this.closed ? n : n + 1;
    return Array.from({ length: count }, (_, i) => {
      const s = (i / n) * this.length;
      return { s, p: this.pointAt(s), t: this.tangentAt(s) };
    });
  }

  /**
   * Places where the track passes over or under itself with too little room between the levels.
   * Returns the positions (on the lower level) of those conflicts.
   */
  conflicts(step = 1) {
    const ss = this.samples(step);
    const out: Vector3[] = [];
    const near = 2.6; // closer than this horizontally means the tracks touch
    const skip = Math.ceil(12 / step); // neighbours along the track are not a crossing
    for (let i = 0; i < ss.length; i++) {
      for (let j = i + skip; j < ss.length; j++) {
        if (this.closed && ss.length - j + i < skip) continue;
        const a = ss[i].p, b = ss[j].p;
        if (Math.hypot(a.x - b.x, a.z - b.z) < near && Math.abs(a.y - b.y) < CLEARANCE) {
          out.push(a.y < b.y ? a.clone() : b.clone());
        }
      }
    }
    return out;
  }
}

export const minPoints = (t: Track) => (t.closed ? MIN_POINTS : MIN_LINE_POINTS);

/** Inserts a new point after point i: halfway to the next one, or beyond the end of a line. */
export function insertAfter(track: Track, i: number): Track {
  const path = new TrackPath(track);
  const n = track.points.length;
  let p: Vector3;
  if (!track.closed && i >= n - 1) {
    p = path.pointAt(path.length + 20);
  } else {
    p = path.curve.getPoint((i + 0.5) / (track.closed ? n : n - 1));
  }
  const points = track.points.slice();
  points.splice(i + 1, 0, [r1(p.x), r1(Math.max(0, p.y)), r1(p.z)]);
  const stations = track.stations.map((st) => (st.point > i ? { ...st, point: st.point + 1 } : st));
  return { ...track, points, stations };
}

export function removePoint(track: Track, i: number): Track {
  if (track.points.length <= minPoints(track)) return track;
  return {
    ...track,
    points: track.points.filter((_, k) => k !== i),
    stations: track.stations.filter((st) => st.point !== i).map((st) => (st.point > i ? { ...st, point: st.point - 1 } : st)),
  };
}

export function movePoint(track: Track, i: number, x: number, z: number): Track {
  const points = track.points.slice();
  points[i] = [r1(x), points[i][1], r1(z)];
  return { ...track, points };
}

export function raisePoint(track: Track, i: number, dy: number): Track {
  const points = track.points.slice();
  const [x, y, z] = points[i];
  points[i] = [x, r1(Math.min(MAX_HEIGHT, Math.max(0, y + dy))), z];
  return { ...track, points };
}

/** Adds a station (with an unused town name) at point i, or removes the one there. */
export function toggleStation(track: Track, i: number): Track {
  if (track.stations.some((s) => s.point === i)) return { ...track, stations: track.stations.filter((s) => s.point !== i) };
  const used = new Set(track.stations.map((s) => s.name));
  const name = TOWN_NAMES.find((n) => !used.has(n)) ?? `Town ${track.stations.length + 1}`;
  return { ...track, stations: [...track.stations, { point: i, name }] };
}

export function renameStation(track: Track, i: number, name: string): Track {
  return { ...track, stations: track.stations.map((s) => (s.point === i ? { ...s, name } : s)) };
}

export function setClosed(track: Track, closed: boolean): Track {
  if (closed && track.points.length < MIN_POINTS) return track;
  return { ...track, closed };
}

/** Accepts saved tracks, including ones from before lines and stations existed. */
export function parseTrack(v: unknown): Track | null {
  const o = v as Partial<Track> | null;
  const pts = o?.points;
  if (!Array.isArray(pts) || !pts.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) return null;
  const closed = o!.closed !== false;
  if (pts.length < (closed ? MIN_POINTS : MIN_LINE_POINTS)) return null;
  const stations = Array.isArray(o!.stations)
    ? o!.stations.filter((s) => Number.isInteger(s?.point) && s.point >= 0 && s.point < pts.length && typeof s.name === "string")
    : [{ point: 0, name: TOWN_NAMES[0] }];
  return { points: pts as Point[], closed, stations };
}
