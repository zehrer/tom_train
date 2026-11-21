import { Vector3 } from "three";
import type { Switches, Track, TrackGraph } from "./track";

/** World units per km/h of model speed (per second). */
export const KMH_TO_UNITS = 0.6 / 3.6;
export const ACCEL = 14; // km/h per second
export const BRAKE = 24;
export const DWELL = 5; // seconds at a station
/** Signals turn green this long before the train leaves. */
export const SIGNAL_LEAD = 1.5;
/** Room left between the train and a buffer stop. */
const END_GAP = 1.5;
const LOOKAHEAD = 400;

/** One edge the train runs over; fwd: from the edge's node a to node b. */
export interface Step {
  edge: number;
  fwd: boolean;
}

/** A piece of an edge a train covers, in edge coordinates (from node a). */
export interface Interval {
  edge: number;
  s0: number;
  s1: number;
}

export interface Stop {
  kind: "station" | "end";
  /** Town name; an end of the line is named after a station right before it. */
  name: string | null;
  /** Index into track.stations. */
  station: number | null;
}

const flip = (s: Step): Step => ({ edge: s.edge, fwd: !s.fwd });

/**
 * Drives one train over the network. The train knows the edges it occupies (`route`, tail to
 * head) and where its head is on the last one. Ahead of the head it follows the switches.
 * It brakes to stop with its middle at each station, and reverses at buffer stops; the loco then
 * stays where it is and pushes (`flipped`).
 */
export class Driver {
  route: Step[] = [];
  /** Distance of the head along the last step, in the direction of travel. */
  h = 0;
  kmh = 0;
  dwell = 0;
  at: Stop | null = null;
  /** true while the loco is at the tail end, pushing. */
  flipped = false;
  /** km/h per second; differs by train type. */
  accel = ACCEL;
  private departing = false;
  private travelled = 0;
  private graph!: TrackGraph;
  private track!: Track;
  private T = 0;
  private switches: Switches = {};

  constructor(graph: TrackGraph, track: Track, trainLength: number, switches: Switches) {
    this.setTrack(graph, track, trainLength, switches);
  }

  // --- Geometry helpers -----------------------------------------------------------------------

  private len(st: Step) {
    return this.graph.edges[st.edge].length;
  }

  endNode(st: Step) {
    const e = this.graph.edges[st.edge];
    return st.fwd ? e.b : e.a;
  }

  private startNode(st: Step) {
    const e = this.graph.edges[st.edge];
    return st.fwd ? e.a : e.b;
  }

  private onStep(st: Step, d: number, target = new Vector3()) {
    return this.graph.pointOn(st.edge, st.fwd ? d : this.len(st) - d, target);
  }

  private tangentOnStep(st: Step, d: number) {
    const t = this.graph.tangentOn(st.edge, st.fwd ? d : this.len(st) - d);
    return st.fwd ? t : t.negate();
  }

  /** The step after `st`, following the switches; null at a buffer stop. */
  nextStep(st: Step): Step | null {
    const node = this.endNode(st);
    const ex = this.graph.exits(node, st.edge);
    if (!ex.length) return null;
    const edge = ex.length === 1 ? ex[0] : ex[this.switches[node] ?? 0];
    return { edge, fwd: this.graph.edges[edge].a === node };
  }

  /** A step leading into `st`; at a switch the branch passing nearest to `hint`. */
  private prevStep(st: Step, hint?: Vector3): Step | null {
    const node = this.startNode(st);
    const ex = this.graph.exits(node, st.edge);
    if (!ex.length) return null;
    let edge = ex[0];
    if (ex.length > 1 && hint) edge = this.graph.nearest(hint, ex).edge;
    return { edge, fwd: this.graph.edges[edge].b === node };
  }

  /** Step index and distance along it of the point `d` behind the head (negative: past the tail). */
  private behind(d: number) {
    let i = this.route.length - 1, off = this.h, rem = d;
    while (rem > off && i > 0) {
      rem -= off;
      i--;
      off = this.len(this.route[i]);
    }
    return { i, at: off - rem };
  }

  pointBehind(d: number, target = new Vector3()) {
    const { i, at } = this.behind(d);
    const st = this.route[i];
    if (at >= 0) return this.onStep(st, at, target);
    // Past the end of the route: continue straight.
    return this.onStep(st, 0, target).addScaledVector(this.tangentOnStep(st, 0), at);
  }

  pointAhead(d: number, target = new Vector3()) {
    let st = this.head;
    let pos = this.h + d;
    while (pos > this.len(st)) {
      const nx = this.nextStep(st);
      if (!nx) return this.onStep(st, this.len(st), target).addScaledVector(this.tangentOnStep(st, this.len(st)), pos - this.len(st));
      pos -= this.len(st);
      st = nx;
    }
    return this.onStep(st, pos, target);
  }

  /** Switch positions change while the train runs; only the way ahead of the head follows them. */
  setSwitches(switches: Switches) {
    this.switches = switches;
  }

  get head(): Step {
    return this.route[this.route.length - 1];
  }

  get trainLength() {
    return this.T;
  }

  // --- Placing the train ----------------------------------------------------------------------

  /** The pieces of track the train stands on. */
  occupied(): Interval[] {
    const out: Interval[] = [];
    let rem = this.T, i = this.route.length - 1, end = this.h;
    while (rem > 0 && i >= 0) {
      const st = this.route[i], len = this.len(st);
      const take = Math.min(end, rem);
      const q0 = end - take, q1 = end;
      out.push(st.fwd ? { edge: st.edge, s0: q0, s1: q1 } : { edge: st.edge, s0: len - q1, s1: len - q0 });
      rem -= take;
      if (--i >= 0) end = this.len(this.route[i]);
    }
    return out;
  }

  /** The steps ahead of the head (following the switches); start = distance from the head to the step's start. */
  aheadSteps(max: number): { step: Step; start: number }[] {
    const out = [{ step: this.head, start: -this.h }];
    let st = this.head, start = this.len(st) - this.h;
    while (start < max) {
      const nx = this.nextStep(st);
      if (!nx) break;
      out.push({ step: nx, start });
      start += this.len(nx);
      st = nx;
    }
    return out;
  }

  /** Length of track under the train (less than its length if it hangs over the end). */
  private covered() {
    let c = this.h;
    for (let k = 0; k < this.route.length - 1; k++) c += this.len(this.route[k]);
    return c;
  }

  private reset() {
    this.kmh = 0;
    this.dwell = 1;
    this.at = null;
    this.flipped = false;
    this.departing = false;
  }

  /** Puts the train with its tail at `node`, pointing out along `edge`. False if it doesn't fit. */
  place(node: number, edge: number) {
    this.route = [{ edge, fwd: this.graph.edges[edge].a === node }];
    this.h = 0;
    this.advance(this.T + (this.graph.degree(node) === 1 ? END_GAP : 0));
    this.fillBehind();
    this.reset();
    return this.covered() >= this.T - 0.01;
  }

  /** Puts the train centred on an edge. False if it doesn't fit. */
  placeMid(edge: number, fwd: boolean) {
    const len = this.graph.edges[edge].length;
    this.route = [{ edge, fwd }];
    this.h = Math.min(len, (len + this.T) / 2);
    this.fillBehind();
    this.reset();
    return this.covered() >= this.T - 0.01;
  }

  /** Moves the head forward without any stopping logic. */
  private advance(ds: number) {
    this.h += ds;
    while (this.h > this.len(this.head)) {
      const nx = this.nextStep(this.head);
      if (!nx) {
        this.h = this.len(this.head);
        break;
      }
      this.h -= this.len(this.head);
      this.route.push(nx);
    }
    // Forget edges the whole train has left.
    for (;;) {
      let covered = this.h;
      for (let k = 1; k < this.route.length - 1; k++) covered += this.len(this.route[k]);
      if (this.route.length < 2 || covered < this.T + 10) break;
      this.route.shift();
    }
  }

  /** Adds edges behind the tail until the whole train is on the route. */
  private fillBehind(hint?: Vector3) {
    let covered = this.covered();
    while (covered < this.T + 10) {
      const p = this.prevStep(this.route[0], hint);
      if (!p) break;
      this.route.unshift(p);
      covered += this.len(p);
    }
  }

  /**
   * Takes over a new or changed track. The train keeps its place in the world (not its distance
   * along the track), so editing never makes it jump.
   */
  setTrack(graph: TrackGraph, track: Track, trainLength: number, switches = this.switches) {
    const old = this.route.length ? { head: this.pointBehind(0), ahead: this.pointAhead(2), tail: this.pointBehind(trainLength) } : null;
    const standing = this.dwell > 0 ? this.at : null;
    this.graph = graph;
    this.track = track;
    this.T = trainLength;
    this.switches = switches;

    if (!old) return this.start();
    const near = graph.nearest(old.head);
    const fwd = graph.tangentOn(near.edge, near.s).dot(old.ahead.clone().sub(old.head)) >= 0;
    this.route = [{ edge: near.edge, fwd }];
    this.h = fwd ? near.s : graph.edges[near.edge].length - near.s;
    this.fillBehind(old.tail);

    // Still standing at the same station if it is (about) where the train's middle is.
    if (!standing || standing.kind === "end") return;
    const st = standing.station !== null ? track.stations[standing.station] : undefined;
    const node = st && st.name === standing.name ? graph.nodes.get(st.node) : undefined;
    if (!node || node.p.distanceTo(this.pointBehind(this.T / 2)) > 4) {
      this.at = null;
      this.dwell = 0;
    }
  }

  /** Puts the train at the first station (or a track end), its tail at the station. */
  private start() {
    const g = this.graph;
    const ends = [...g.nodes.values()].filter((n) => n.edges.length === 1).map((n) => n.id);
    const startNode = this.track.stations.find((s) => g.degree(s.node) > 0)?.node ?? ends[0] ?? g.edges[0].a;
    this.place(startNode, g.nodes.get(startNode)!.edges[0]);
  }

  // --- Driving ---------------------------------------------------------------------------------

  /** The next stop for the train's middle and the distance to it. */
  next(): { stop: Stop; d: number } | null {
    const { i, at } = this.behind(this.T / 2);
    let k = i, st = this.route[i];
    let dist = this.len(st) - Math.max(0, at);
    const found: { stop: Stop; d: number }[] = [];
    let lastStation: { index: number; d: number } | null = null;
    const min = this.departing ? 0.5 : -0.01;
    while (dist < LOOKAHEAD) {
      const node = this.endNode(st);
      const si = this.track.stations.findIndex((s) => s.node === node);
      if (si >= 0) {
        lastStation = { index: si, d: dist };
        if (dist > min) found.push({ stop: { kind: "station", name: this.track.stations[si].name, station: si }, d: dist });
      }
      const nx = k < this.route.length - 1 ? this.route[k + 1] : this.nextStep(st);
      if (!nx) {
        const d = dist - this.T / 2 - END_GAP;
        const named = lastStation && lastStation.d > d - 0.01 && lastStation.d - d < this.T / 2 + END_GAP + 3 ? lastStation.index : null;
        found.push({ stop: { kind: "end", name: named !== null ? this.track.stations[named].name : null, station: named }, d });
        break;
      }
      if (found.length && dist > found[0].d + this.T / 2 + END_GAP + 2) break;
      k++;
      st = nx;
      dist += this.len(st);
    }
    // A station so close to the end that the train can't reach it is served by the end stop.
    const end = found.find((f) => f.stop.kind === "end");
    const usable = found.filter((f) => f.stop.kind === "end" || !end || f.d <= end.d);
    return usable.sort((a, b) => a.d - b.d)[0] ?? null;
  }

  /** The next switch the train will pass through from its trunk, where its way can differ. */
  nextSwitch(max = 300): { node: number; d: number } | null {
    let st = this.head;
    let dist = this.len(st) - this.h;
    while (dist < max) {
      const node = this.endNode(st);
      if (this.graph.exits(node, st.edge).length === 2) return { node, d: dist };
      const nx = this.nextStep(st);
      if (!nx) return null;
      st = nx;
      dist += this.len(st);
    }
    return null;
  }

  private arrive(stop: Stop) {
    this.kmh = 0;
    this.dwell = DWELL;
    this.at = stop;
    this.departing = false;
    // At a buffer stop the train leaves the other way; signals and the cab follow at once.
    if (stop.kind === "end") this.reverse();
  }

  /** Turns the direction of travel around: the tail becomes the head. */
  reverse() {
    const { i, at } = this.behind(this.T);
    const tail = Math.max(0, at);
    const len = this.len(this.route[i]);
    this.route = this.route.slice(i).reverse().map(flip);
    this.h = len - tail;
    this.flipped = !this.flipped;
    this.fillBehind();
  }

  /** Whether the train is about to leave (or moving): the exit signal shows green. */
  get clear() {
    return this.dwell <= SIGNAL_LEAD;
  }

  /**
   * Advances by dt seconds; cruise = 0 stops the train where it is. `limit` is how far the head may
   * go (another train ahead). Returns the distance moved.
   */
  update(dt: number, cruise: number, limit = Infinity) {
    if (this.dwell > 0) {
      if (cruise <= 0) return 0; // the clock waits while stopped by hand
      this.dwell -= dt;
      if (this.dwell > 0) return 0;
      this.dwell = 0;
      this.departing = true;
      this.travelled = 0;
    }

    const ahead = this.next();
    const room = Math.max(0, limit);
    let target = cruise;
    const stopAt = Math.min(ahead ? ahead.d : Infinity, room);
    if (stopAt < Infinity) {
      // Fastest speed that still lets the train stop in time; a small floor makes it arrive.
      const allowed = Math.sqrt(2 * BRAKE * KMH_TO_UNITS * Math.max(0, stopAt)) / KMH_TO_UNITS;
      target = Math.min(cruise, Math.max(allowed, cruise > 0 && stopAt > 0.05 ? 3 : 0));
    }
    this.kmh = this.kmh < target ? Math.min(target, this.kmh + this.accel * dt) : Math.max(target, this.kmh - BRAKE * 1.5 * dt);

    const step = this.kmh * KMH_TO_UNITS * dt;
    if (ahead && !this.departing && step >= ahead.d - 0.02 && ahead.d <= room + 0.02) {
      const moved = Math.max(0, ahead.d);
      this.advance(moved);
      this.arrive(ahead.stop);
      return moved;
    }
    if (step >= room) {
      // Right behind another train.
      this.advance(room);
      this.kmh = 0;
      return room;
    }
    this.advance(step);
    this.travelled += step;
    if (this.travelled > 0.5) this.departing = false;
    return step;
  }
}
