import { Vector3 } from "three";
import { Driver, type Interval, type Step } from "./drive";
import type { Switches, Track, TrackGraph } from "./track";

/** Room a train keeps to the train ahead. */
export const TRAIN_GAP = 4;
/** Tracks closer than this (centre to centre) are too close for two trains side by side. */
const SIDE_BY_SIDE = 3.4;
/** Trains this close to a switch claim it; the nearest one goes first. */
const CLAIM = 80;
const LOOK = 300;
/** Trains facing each other: the one with the higher id backs off after this many seconds. */
const STANDOFF = 3;
/** Blocked by a train that doesn't move away: try reversing after this long. */
const STUCK = 12;
/** Auto switches look this far along each branch for trains. */
const BRANCH_LOOK = 120;
/** Trains are placed at least this far from each other. */
const SPACING = 6;

export interface TrainSlot {
  id: number;
  driver: Driver;
  maxKmh: number;
  /** How far the head may go before it is too close to another train. */
  limit: number;
  /** The train in the way, if any. */
  blocker: number | null;
  /** Seconds the train has been held up by another one. */
  blocked: number;
  occ: Interval[];
  /** Switches ahead: the edge the train comes in on and its distance. */
  approach: { node: number; edge: number; d: number }[];
}

export interface TrainOptions {
  maxKmh: number;
  accel: number;
}

/**
 * Several trains on one network. Every train stops short of the trains ahead of it, turns
 * switches in front of it towards a free track, and when two trains stand face to face one of
 * them backs off.
 */
export class Traffic {
  trains: TrainSlot[] = [];
  /** Per switch and edge: how far from the switch the edge is too close to the others. */
  private foul = new Map<string, number>();

  constructor(
    private graph: TrackGraph,
    private track: Track,
    private switches: Switches,
  ) {
    this.measureSwitches();
  }

  /** Clearance points: where each track at a switch is far enough from the other tracks. */
  private measureSwitches() {
    const g = this.graph;
    this.foul.clear();
    for (const n of g.nodes.values()) {
      if (n.edges.length < 3) continue;
      const along = (e: number, s: number) => {
        const E = g.edges[e];
        return g.pointOn(e, Math.min(E.length, E.a === n.id ? s : E.length - s));
      };
      for (const e of n.edges) {
        let s = 0;
        const len = g.edges[e].length;
        for (; s < Math.min(len, 40); s += 0.5) {
          const p = along(e, s);
          let near = Infinity;
          for (const o of n.edges) if (o !== e) for (let q = 0; q <= Math.min(g.edges[o].length, 40); q += 0.5) near = Math.min(near, p.distanceTo(along(o, q)));
          if (near > SIDE_BY_SIDE) break;
        }
        this.foul.set(`${n.id}:${e}`, s);
      }
    }
  }

  private foulAt(node: number, edge: number) {
    return this.foul.get(`${node}:${edge}`) ?? 0;
  }

  private approaches(t: TrainSlot) {
    const g = this.graph;
    return t.driver
      .aheadSteps(CLAIM)
      .map(({ step, start }) => ({ node: t.driver.endNode(step), edge: step.edge, d: start + g.edges[step.edge].length }))
      .filter((a) => a.d < CLAIM && g.degree(a.node) >= 3);
  }

  get(id: number) {
    return this.trains.find((t) => t.id === id);
  }

  setTrack(graph: TrackGraph, track: Track) {
    this.graph = graph;
    this.track = track;
    this.measureSwitches();
    for (const t of this.trains) {
      t.driver.setTrack(graph, track, t.driver.trainLength, this.switches);
      t.occ = t.driver.occupied();
      t.approach = this.approaches(t);
    }
  }

  setSwitches(switches: Switches) {
    this.switches = switches;
    for (const t of this.trains) t.driver.setSwitches(switches);
  }

  /** Adds a train at the first free place (stations first). False if there is no room. */
  add(id: number, length: number, opts: TrainOptions): boolean {
    const d = new Driver(this.graph, this.track, length, this.switches);
    d.accel = opts.accel;
    const taken = this.trains.map((t) => samples(t.driver));
    const free = () => {
      const mine = samples(d);
      return taken.every((pts) => pts.every((q) => mine.every((p) => p.distanceTo(q) >= SPACING)));
    };
    const g = this.graph;
    const stations = this.track.stations.map((s) => s.node).filter((n) => g.degree(n) > 0);
    const k = this.trains.length % Math.max(1, stations.length);
    const tries: (() => boolean)[] = [];
    for (const node of [...stations.slice(k), ...stations.slice(0, k)]) for (const e of g.nodes.get(node)!.edges) tries.push(() => d.place(node, e));
    for (const e of [...g.edges].sort((a, b) => b.length - a.length)) for (const fwd of [true, false]) tries.push(() => d.placeMid(e.index, fwd));
    if (!tries.some((t) => t() && free())) return false;
    const slot: TrainSlot = { id, driver: d, maxKmh: opts.maxKmh, limit: Infinity, blocker: null, blocked: 0, occ: d.occupied(), approach: [] };
    slot.approach = this.approaches(slot);
    this.trains.push(slot);
    return true;
  }

  remove(id: number) {
    this.trains = this.trains.filter((t) => t.id !== id);
  }

  /** New length or type: the train keeps its place. */
  change(id: number, length: number, opts: TrainOptions) {
    const t = this.get(id);
    if (!t) return;
    t.driver.setTrack(this.graph, this.track, length, this.switches);
    t.driver.accel = opts.accel;
    t.maxKmh = opts.maxKmh;
    t.occ = t.driver.occupied();
    t.approach = this.approaches(t);
  }

  /** Distance from `t`'s head to the nearest other train (or a switch it blocks) on its way. */
  clearance(t: TrainSlot, max = LOOK): { d: number; by: number | null } {
    const g = this.graph;
    let best = Infinity, by: number | null = null;
    const steps = t.driver.aheadSteps(max);
    steps.forEach(({ step, start }, i) => {
      if (start > best) return;
      const len = g.edges[step.edge].length;
      const node = t.driver.endNode(step);
      const next: Step | undefined = steps[i + 1]?.step;
      const atNode = g.nodes.get(node)!.edges;
      const isSwitch = atNode.length >= 3;
      // Where this train has to stop to keep the switch clear.
      const before = start + len - this.foulAt(node, step.edge);
      const claim = (d: number, id: number) => {
        if (d < best) (best = Math.max(0, d)), (by = id);
      };
      for (const o of this.trains) {
        if (o === t) continue;
        for (const iv of o.occ) {
          if (iv.edge === step.edge) {
            const qa = step.fwd ? iv.s0 : len - iv.s1, qb = step.fwd ? iv.s1 : len - iv.s0;
            if (start + qb <= 0.01) continue; // behind the head
            const d = Math.max(0, start + qa);
            if (d < best) (best = d), (by = o.id);
          } else if (isSwitch && iv.edge !== next?.edge && atNode.includes(iv.edge)) {
            // On another track, too close to the switch ahead.
            const e = g.edges[iv.edge];
            const gap = e.a === node ? iv.s0 : e.length - iv.s1;
            if (gap < this.foulAt(node, iv.edge)) claim(before, o.id);
          }
        }
        // Heading for the same switch from another track and nearer to it: it goes first.
        if (isSwitch && start + len < CLAIM)
          for (const a of o.approach)
            if (a.node === node && a.edge !== step.edge && (a.d < start + len || (a.d === start + len && o.id < t.id))) claim(before, o.id);
      }
    });
    return { d: best, by };
  }

  /** Whether another train is on the way from `node` along `edge`. */
  private busy(t: TrainSlot, node: number, edge: number) {
    const g = this.graph;
    let step: Step | null = { edge, fwd: g.edges[edge].a === node };
    let dist = 0;
    while (step && dist < BRANCH_LOOK) {
      const e = step.edge;
      if (this.trains.some((o) => o !== t && o.occ.some((iv) => iv.edge === e))) return true;
      dist += g.edges[e].length;
      step = t.driver.nextStep(step);
    }
    return false;
  }

  /** Turns switches ahead of trains away from occupied tracks. Returns the switches turned. */
  private autoSwitches(): number[] {
    const turned: number[] = [];
    for (const t of this.trains) {
      const sw = t.driver.nextSwitch(150);
      if (!sw) continue;
      const branches = this.graph.nodes.get(sw.node)?.branches;
      if (!branches) continue;
      const set = this.switches[sw.node] ?? 0;
      if (this.busy(t, sw.node, branches[set]) && !this.busy(t, sw.node, branches[1 - set])) {
        this.setSwitches({ ...this.switches, [sw.node]: set ? 0 : 1 });
        turned.push(sw.node);
      }
    }
    return turned;
  }

  private tryReverse(t: TrainSlot) {
    const d = t.driver;
    d.reverse();
    t.occ = d.occupied();
    t.approach = this.approaches(t);
    const stop = d.next();
    const room = Math.min(this.clearance(t, 40).d, stop?.stop.kind === "end" ? stop.d : Infinity);
    if (room < TRAIN_GAP + 6) {
      d.reverse(); // no way out on this side either
      t.occ = d.occupied();
      t.approach = this.approaches(t);
      return false;
    }
    return true;
  }

  /** Advances all trains. Returns the distance each moved and the switches turned on the way. */
  update(dt: number, cruise: number): { moved: Map<number, number>; turned: number[] } {
    const moved = new Map<number, number>();
    const multi = this.trains.length > 1;
    const turned = multi && cruise > 0 ? this.autoSwitches() : [];
    for (const t of this.trains) {
      const c = multi ? this.clearance(t) : { d: Infinity, by: null };
      t.limit = c.d - TRAIN_GAP;
      t.blocker = c.by;
      moved.set(t.id, t.driver.update(dt, Math.min(cruise, t.maxKmh), t.limit));
      t.occ = t.driver.occupied();
      t.approach = this.approaches(t);
    }
    // Held up for a while: back off (face to face, the higher id first).
    for (const t of this.trains) {
      const d = t.driver;
      if (cruise > 0 && d.dwell <= 0 && t.limit < 0.5 && d.kmh < 0.5) t.blocked += dt;
      else t.blocked = 0;
      if (!t.blocked) continue;
      const other = t.blocker !== null ? this.get(t.blocker) : undefined;
      const faceToFace = other?.blocker === t.id;
      const wait = faceToFace ? (t.id > other!.id ? STANDOFF : 2 * STANDOFF + 1) : STUCK;
      if (t.blocked > wait) {
        t.blocked = 0;
        if (this.tryReverse(t)) t.blocker = null;
      }
    }
    return { moved, turned };
  }
}

function samples(d: Driver) {
  const out: Vector3[] = [];
  for (let x = 0; x <= d.trainLength + 0.01; x += 2) out.push(d.pointBehind(x));
  return out;
}
