import { CubicBezierCurve3, Matrix4, Quaternion, Vector3 } from "three";

/**
 * The railway is a network: nodes (control points) joined by edges (pieces of track).
 * A node with one edge is a buffer stop, with two a plain point, with three a switch.
 */
export interface Node {
  id: number;
  x: number;
  /** Height of the track bed above the ground. */
  y: number;
  z: number;
}

/** A station sits at a node; a town grows around it. */
export interface Station {
  node: number;
  name: string;
}

export interface Track {
  nodes: Node[];
  edges: [a: number, b: number][];
  stations: Station[];
}

/** Which branch a switch leads to when entered from its trunk: 0 straight, 1 diverging. */
export type Switches = Record<number, 0 | 1>;

export const MAX_DEGREE = 3;
export const MAX_HEIGHT = 8;
/** Height difference between two crossing tracks that a train fits through. */
export const CLEARANCE = 3.6;
const NEW_TRACK = 22;
const BRANCH_ANGLE = (28 * Math.PI) / 180;

export const TOWN_NAMES = [
  "Lindenberg", "Mühlbach", "Eichstadt", "Rosenhain", "Birkenau", "Tannfeld", "Weidental", "Ahornhausen",
  "Erlenbrück", "Buchwald", "Kirschdorf", "Steinach",
];

const r1 = (n: number) => Math.round(n * 10) / 10 + 0; // + 0 turns -0 into 0

// --- Presets ---------------------------------------------------------------------------------

export type PresetId = "network" | "line" | "oval" | "eight" | "hills";

export const PRESETS: { id: PresetId; name: string }[] = [
  { id: "network", name: "Network with switches" },
  { id: "line", name: "Line with towns" },
  { id: "oval", name: "Oval" },
  { id: "eight", name: "Figure eight" },
  { id: "hills", name: "Hills" },
];

type P = [x: number, y: number, z: number];

/** Nodes for the points (ids from `first`) and edges joining them in order. */
function chain(points: P[], closed: boolean, first = 0): Pick<Track, "nodes" | "edges"> {
  const nodes = points.map(([x, y, z], i) => ({ id: first + i, x: r1(x), y: r1(y), z: r1(z) }));
  const edges: [number, number][] = nodes.slice(1).map((n, i) => [nodes[i].id, n.id]);
  if (closed) edges.push([nodes[nodes.length - 1].id, nodes[0].id]);
  return { nodes, edges };
}

function ring(n: number, fn: (t: number) => P): P[] {
  return Array.from({ length: n }, (_, i) => fn((i / n) * Math.PI * 2));
}

const loop = (points: P[], station: number): Track => ({ ...chain(points, true), stations: [{ node: station, name: TOWN_NAMES[0] }] });

const LINE: P[] = [
  [-140, 0, 0], [-120, 0, 4], [-100, 1, 14], [-80, 2, 22], [-62, 0.5, 18], [-44, 0, 8], [-26, 0, -2],
  [-8, 1.5, -14], [12, 3, -24], [32, 1.5, -20], [52, 0, -8], [70, 0, 4], [90, 1, 14], [112, 0.5, 12], [140, 0, 4],
];

export function preset(id: PresetId): Track {
  switch (id) {
    case "oval": {
      // A stadium: two straights joined by half circles, sampled evenly along its length.
      const straight = 44, radius = 20, half = straight / 2;
      const total = 2 * straight + 2 * Math.PI * radius;
      return loop(
        ring(16, (t) => {
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
      return loop(ring(20, (t) => [a * Math.sin(t), h * ((1 + Math.cos(t)) / 2) ** 2, a * Math.sin(t) * Math.cos(t)]), 12);
    }
    case "hills":
      return loop(
        ring(18, (t) => {
          const r = 34 + 7 * Math.sin(3 * t);
          return [1.2 * r * Math.cos(t), 2.2 * (1 - Math.cos(2 * t)), r * Math.sin(t)];
        }),
        0,
      );
    case "line":
      return { ...chain(LINE, false), stations: [0, 5, 10, 14].map((node, i) => ({ node, name: TOWN_NAMES[i] })) };
    case "network": {
      // The line, a passing loop at Mühlbach on the inside of the bend (switches at nodes 4 and 6) and a
      // branch to Birkenau (switch at 11).
      const main = chain(LINE, false);
      const passing = chain([[-52, 0, 4], [-36, 0, -6]], false, 100);
      const branch = chain([[84, 0, 28], [92, 0, 52], [96, 0, 78]], false, 200);
      return {
        nodes: [...main.nodes, ...passing.nodes, ...branch.nodes],
        edges: [...main.edges, [4, 100], ...passing.edges, [101, 6], [11, 200], ...branch.edges],
        stations: [...[0, 5, 10, 14].map((node, i) => ({ node, name: TOWN_NAMES[i] })), { node: 202, name: TOWN_NAMES[4] }],
      };
    }
  }
}

// --- Geometry --------------------------------------------------------------------------------

export interface GraphEdge {
  index: number;
  a: number;
  b: number;
  curve: CubicBezierCurve3;
  length: number;
}

export interface GraphNode {
  id: number;
  p: Vector3;
  /** Indices of the edges meeting here. */
  edges: number[];
  /** Direction of the track through this node (its sign is arbitrary). */
  tangent: Vector3;
  /** For a switch: the edge on the common side and the two branches [straight, diverging]. */
  trunk?: number;
  branches?: [number, number];
}

/** A place on the network: an edge and the distance from its node a. */
export interface Place {
  edge: number;
  s: number;
}

/**
 * The network's geometry. Every edge is a cubic curve; all edges meeting at a node share the
 * node's tangent, so the track is smooth through plain points and switches alike.
 */
export class TrackGraph {
  readonly nodes = new Map<number, GraphNode>();
  readonly edges: GraphEdge[] = [];
  readonly length: number;

  constructor(track: Track) {
    for (const n of track.nodes) this.nodes.set(n.id, { id: n.id, p: new Vector3(n.x, n.y, n.z), edges: [], tangent: new Vector3(1, 0, 0) });
    track.edges.forEach(([a, b], i) => {
      this.nodes.get(a)!.edges.push(i);
      this.nodes.get(b)!.edges.push(i);
    });
    for (const n of this.nodes.values()) this.shapeNode(n, track);
    track.edges.forEach(([a, b], index) => {
      const pa = this.nodes.get(a)!, pb = this.nodes.get(b)!;
      const chord = pb.p.clone().sub(pa.p);
      const L = chord.length();
      const ta = pa.tangent.clone().multiplyScalar(Math.sign(pa.tangent.dot(chord)) || 1);
      const tb = pb.tangent.clone().multiplyScalar(Math.sign(pb.tangent.dot(chord)) || 1);
      const curve = new CubicBezierCurve3(pa.p, pa.p.clone().addScaledVector(ta, L / 3), pb.p.clone().addScaledVector(tb, -L / 3), pb.p);
      curve.arcLengthDivisions = Math.max(40, Math.ceil(L * 2));
      this.edges.push({ index, a, b, curve, length: curve.getLength() });
    });
    this.length = this.edges.reduce((sum, e) => sum + e.length, 0);
  }

  private shapeNode(n: GraphNode, track: Track) {
    const dirs = n.edges.map((e) => {
      const [a, b] = track.edges[e];
      return this.nodes.get(a === n.id ? b : a)!.p.clone().sub(n.p).setY(0).normalize();
    });
    if (dirs.length === 1) n.tangent.copy(dirs[0]);
    else if (dirs.length === 2) n.tangent.copy(dirs[1]).sub(dirs[0]).normalize();
    else if (dirs.length >= 3) {
      // The trunk points away from the other two; the branch most opposite to it is "straight".
      let trunk = 0, best = Infinity;
      dirs.forEach((d, i) => {
        const v = dirs.reduce((sum, o, k) => (k === i ? sum : sum + d.dot(o)), 0);
        if (v < best) (best = v), (trunk = i);
      });
      const br = [0, 1, 2].filter((i) => i !== trunk).sort((i, k) => dirs[i].dot(dirs[trunk]) - dirs[k].dot(dirs[trunk]));
      n.trunk = n.edges[trunk];
      n.branches = [n.edges[br[0]], n.edges[br[1]]];
      n.tangent.copy(dirs[br[0]]).sub(dirs[trunk]).normalize();
    }
    if (n.tangent.lengthSq() < 1e-6) n.tangent.set(1, 0, 0);
  }

  other(edge: number, node: number) {
    const e = this.edges[edge];
    return e.a === node ? e.b : e.a;
  }

  degree(node: number) {
    return this.nodes.get(node)?.edges.length ?? 0;
  }

  pointOn(edge: number, s: number, target = new Vector3()) {
    const e = this.edges[edge];
    return e.curve.getPointAt(Math.min(1, Math.max(0, s / e.length)), target);
  }

  /** Tangent in the direction from node a to node b. */
  tangentOn(edge: number, s: number, target = new Vector3()) {
    const e = this.edges[edge];
    return e.curve.getTangentAt(Math.min(1, Math.max(0, s / e.length)), target);
  }

  /**
   * Edges a train can continue on after reaching `node` along `from`. At a switch, from the trunk
   * both branches (straight first), from a branch only the trunk.
   */
  exits(node: number, from: number): number[] {
    const n = this.nodes.get(node)!;
    if (n.trunk !== undefined) return from === n.trunk ? n.branches! : [n.trunk];
    return n.edges.filter((e) => e !== from);
  }

  /** Evenly spaced samples on every edge, each edge including both ends. */
  samples(step: number) {
    const out: { edge: number; s: number; p: Vector3; t: Vector3 }[] = [];
    for (const e of this.edges) {
      const n = Math.max(1, Math.round(e.length / step));
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * e.length;
        out.push({ edge: e.index, s, p: this.pointOn(e.index, s), t: this.tangentOn(e.index, s) });
      }
    }
    return out;
  }

  /** The place on the network closest to p (in 3D, so bridges and the track below differ). */
  nearest(p: Vector3, onlyEdges?: number[]): Place & { distance: number } {
    let best: Place = { edge: 0, s: 0 }, bestD = Infinity;
    const v = new Vector3();
    for (const e of this.edges) {
      if (onlyEdges && !onlyEdges.includes(e.index)) continue;
      const n = Math.max(1, Math.round(e.length / 2));
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * e.length;
        const d = this.pointOn(e.index, s, v).distanceToSquared(p);
        if (d < bestD) (bestD = d), (best = { edge: e.index, s });
      }
    }
    const e = this.edges[best.edge];
    for (let s = Math.max(0, best.s - 2); s <= Math.min(e.length, best.s + 2); s += 0.05) {
      const d = this.pointOn(e.index, s, v).distanceToSquared(p);
      if (d < bestD) (bestD = d), (best = { edge: e.index, s });
    }
    return { ...best, distance: Math.sqrt(bestD) };
  }

  /**
   * Places where tracks pass over or under each other with too little room between the levels.
   * Tracks meeting at a node (switches, joints) are not crossings.
   */
  conflicts(step = 1.5) {
    const ss = this.samples(step);
    const nodes = [...this.nodes.values()];
    const out: Vector3[] = [];
    const near = 2.6;
    for (let i = 0; i < ss.length; i++) {
      for (let j = i + 1; j < ss.length; j++) {
        const a = ss[i], b = ss[j];
        if (Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) >= near || Math.abs(a.p.y - b.p.y) >= CLEARANCE) continue;
        if (a.edge === b.edge && Math.abs(a.s - b.s) < 12) continue;
        // Tracks leaving the same node (a switch, a joint) run side by side near it.
        const joined = (n: GraphNode) => n.edges.includes(a.edge) && n.edges.includes(b.edge);
        const close = (n: GraphNode, q: Vector3) => Math.hypot(q.x - n.p.x, q.z - n.p.z) < 14;
        if (nodes.some((n) => joined(n) && close(n, a.p) && close(n, b.p))) continue;
        out.push(a.p.y < b.p.y ? a.p.clone() : b.p.clone());
      }
    }
    return out;
  }
}

/** Orientation of a vehicle whose front and rear bogies stand at the given points. */
export function poseBetween(front: Vector3, back: Vector3, position = new Vector3(), quaternion = new Quaternion()) {
  position.copy(front).add(back).multiplyScalar(0.5);
  const z = front.clone().sub(back).normalize();
  const x = new Vector3(0, 1, 0).cross(z).normalize();
  const y = new Vector3().crossVectors(z, x);
  quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  return { position, quaternion };
}

// --- Editing ---------------------------------------------------------------------------------

export const degree = (t: Track, id: number) => t.edges.filter(([a, b]) => a === id || b === id).length;
const neighbours = (t: Track, id: number) => t.edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
const nodeOf = (t: Track, id: number) => t.nodes.find((n) => n.id === id)!;
const nextId = (t: Track) => Math.max(-1, ...t.nodes.map((n) => n.id)) + 1;

export function moveNode(track: Track, id: number, x: number, z: number): Track {
  return { ...track, nodes: track.nodes.map((n) => (n.id === id ? { ...n, x: r1(x), z: r1(z) } : n)) };
}

export function raiseNode(track: Track, id: number, dy: number): Track {
  return { ...track, nodes: track.nodes.map((n) => (n.id === id ? { ...n, y: r1(Math.min(MAX_HEIGHT, Math.max(0, n.y + dy))) } : n)) };
}

/**
 * New track from a node: straight on from a track end, or as a branch from a plain point, which
 * turns it into a switch. Returns the track and the new node's id (null when nothing changed).
 */
export function extend(track: Track, id: number): { track: Track; node: number | null } {
  const deg = degree(track, id);
  if (deg === 0 || deg >= MAX_DEGREE) return { track, node: null };
  const n = nodeOf(track, id);
  const nb = neighbours(track, id).map((k) => nodeOf(track, k));
  const away = new Vector3(n.x - nb[0].x, 0, n.z - nb[0].z).normalize();
  let dir = away;
  if (deg === 2) {
    // Branch off towards the second neighbour, turned aside to the outside of the bend.
    const toward = new Vector3(nb[1].x - n.x, 0, nb[1].z - n.z).normalize();
    const side = -Math.sign(away.x * toward.z - away.z * toward.x) || 1;
    dir = toward.clone().applyAxisAngle(new Vector3(0, 1, 0), side * BRANCH_ANGLE);
  }
  const node = nextId(track);
  return {
    node,
    track: noStationsOnSwitches({
      ...track,
      nodes: [...track.nodes, { id: node, x: r1(n.x + dir.x * NEW_TRACK), y: n.y, z: r1(n.z + dir.z * NEW_TRACK) }],
      edges: [...track.edges, [id, node]],
    }),
  };
}

/** Splits an edge with a new node at the given distance from its node a (default: halfway). */
export function split(track: Track, edge: number, s?: number): { track: Track; node: number } {
  const g = new TrackGraph(track);
  const e = g.edges[edge];
  const p = g.pointOn(edge, s ?? e.length / 2);
  const node = nextId(track);
  const edges = track.edges.slice();
  edges.splice(edge, 1, [e.a, node], [node, e.b]);
  return { node, track: { ...track, nodes: [...track.nodes, { id: node, x: r1(p.x), y: r1(Math.max(0, p.y)), z: r1(p.z) }], edges } };
}

/** Joins two nodes with a new edge, if both have room for it and they aren't joined already. */
export function connect(track: Track, a: number, b: number): Track {
  if (a === b || degree(track, a) >= MAX_DEGREE || degree(track, b) >= MAX_DEGREE) return track;
  if (track.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return track;
  return noStationsOnSwitches({ ...track, edges: [...track.edges, [a, b]] });
}

/** Stations can't stand on switches; one that would is removed. */
function noStationsOnSwitches(track: Track): Track {
  return { ...track, stations: track.stations.filter((s) => degree(track, s.node) < 3) };
}

function dropIsolated(track: Track): Track {
  const used = new Set(track.edges.flat());
  return { ...track, nodes: track.nodes.filter((n) => used.has(n.id)), stations: track.stations.filter((s) => used.has(s.node)) };
}

/** Removes a node; the two tracks through a plain point are joined again. */
export function removeNode(track: Track, id: number): Track {
  const nb = neighbours(track, id);
  let edges = track.edges.filter(([a, b]) => a !== id && b !== id);
  if (nb.length === 2 && !edges.some(([a, b]) => (a === nb[0] && b === nb[1]) || (a === nb[1] && b === nb[0]))) {
    edges = [...edges, [nb[0], nb[1]]];
  }
  if (!edges.length) return track;
  return dropIsolated({ ...track, nodes: track.nodes.filter((n) => n.id !== id), edges, stations: track.stations.filter((s) => s.node !== id) });
}

export function removeEdge(track: Track, edge: number): Track {
  if (track.edges.length <= 1) return track;
  return dropIsolated({ ...track, edges: track.edges.filter((_, i) => i !== edge) });
}

/** Adds a station (with an unused town name) at a node, or removes the one there. Not on switches. */
export function toggleStation(track: Track, id: number): Track {
  if (track.stations.some((s) => s.node === id)) return { ...track, stations: track.stations.filter((s) => s.node !== id) };
  if (degree(track, id) >= 3) return track;
  const used = new Set(track.stations.map((s) => s.name));
  const name = TOWN_NAMES.find((n) => !used.has(n)) ?? `Town ${track.stations.length + 1}`;
  return { ...track, stations: [...track.stations, { node: id, name }] };
}

export function renameStation(track: Track, id: number, name: string): Track {
  return { ...track, stations: track.stations.map((s) => (s.node === id ? { ...s, name } : s)) };
}

/** Reads saved tracks, including the older single loop/line format (points + closed). */
export function parseTrack(v: unknown): Track | null {
  const o = v as Record<string, unknown> | null;
  if (!o) return null;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (Array.isArray(o.points)) {
    const pts = o.points as unknown[];
    if (!pts.every((p) => Array.isArray(p) && p.length === 3 && p.every(finite))) return null;
    const closed = o.closed !== false;
    if (pts.length < (closed ? 3 : 2)) return null;
    const stations = Array.isArray(o.stations)
      ? (o.stations as { point: number; name: string }[])
          .filter((s) => Number.isInteger(s?.point) && s.point >= 0 && s.point < pts.length && typeof s.name === "string")
          .map((s) => ({ node: s.point, name: s.name }))
      : [{ node: 0, name: TOWN_NAMES[0] }];
    return { ...chain(pts as P[], closed), stations };
  }
  const nodes = o.nodes as Node[] | undefined;
  const edges = o.edges as [number, number][] | undefined;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !edges.length) return null;
  if (!nodes.every((n) => Number.isInteger(n?.id) && finite(n.x) && finite(n.y) && finite(n.z))) return null;
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null;
  if (!edges.every((e) => Array.isArray(e) && e.length === 2 && ids.has(e[0]) && ids.has(e[1]) && e[0] !== e[1])) return null;
  const track: Track = {
    nodes: nodes.map(({ id, x, y, z }) => ({ id, x, y, z })),
    edges: edges.map(([a, b]) => [a, b]),
    stations: Array.isArray(o.stations)
      ? (o.stations as Station[]).filter((s) => ids.has(s?.node) && typeof s.name === "string").map(({ node, name }) => ({ node, name }))
      : [],
  };
  if (track.nodes.some((n) => degree(track, n.id) > MAX_DEGREE)) return null;
  return dropIsolated(track);
}
