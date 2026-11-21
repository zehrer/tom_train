import * as THREE from "three";
import type { Track, TrackGraph } from "../model/track";

/**
 * Trees and farmhouses on the endless ground. Nothing is stored: the land is cut into square
 * cells, and what grows in a cell follows from its coordinates alone, so a cell looks the same
 * every time it comes into view. Only the cells around the camera, out to the fog, are shown.
 */
const CELL = 40;
/** A little past the fog's far end. */
const VIEW = 720;
const MAX_TREES = 14000;
const MAX_HOUSES = 500;
/** Free room around the track and the towns. */
const TRACK_ROOM_TREE = 4.5;
const TRACK_ROOM_HOUSE = 9;
const TOWN_ROOM = 40;
/** Track points are looked up in a grid of this size. */
const GRID = 10;

interface Tree {
  x: number;
  z: number;
  scale: number;
  /** Conifer (cone) or leafy tree (ball). */
  leafy: boolean;
}
interface House {
  x: number;
  z: number;
  rot: number;
}

/** A fixed random number in [0, 1) for three integers. */
function hash(a: number, b: number, c: number) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise in [0, 1): large patches, for forests and meadows. */
function noise(x: number, z: number, scale: number, seed: number) {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = smooth(fx - ix), tz = smooth(fz - iz);
  const v = (i: number, k: number) => hash(ix + i, iz + k, seed);
  return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - tz) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * tz;
}

export class Scenery {
  readonly group = new THREE.Group();
  private trunk: THREE.InstancedMesh;
  private cone: THREE.InstancedMesh;
  private ball: THREE.InstancedMesh;
  private body: THREE.InstancedMesh;
  private roof: THREE.InstancedMesh;
  private cells = new Map<string, { trees: Tree[]; houses: House[] }>();
  private trackGrid = new Map<string, THREE.Vector3[]>();
  private towns: THREE.Vector3[] = [];
  private shownAt: string | null = null;

  constructor() {
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      // Instances change all the time; the whole set spans the view anyway.
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.trunk = inst(new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0), new THREE.MeshStandardMaterial({ color: 0x6d4c33 }), MAX_TREES);
    this.cone = inst(new THREE.ConeGeometry(1.6, 4, 8).translate(0, 3.4, 0), new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 }), MAX_TREES);
    this.ball = inst(new THREE.IcosahedronGeometry(1.7, 1).translate(0, 3.2, 0), new THREE.MeshStandardMaterial({ color: 0x5b9a3c, roughness: 0.9, flatShading: true }), MAX_TREES);
    this.body = inst(new THREE.BoxGeometry(5, 3.4, 4).translate(0, 1.7, 0), new THREE.MeshStandardMaterial({ color: 0xf5efe3 }), MAX_HOUSES);
    const roof = new THREE.ConeGeometry(4.2, 2.4, 4);
    roof.rotateY(Math.PI / 4);
    roof.scale(1.25, 1, 1);
    roof.translate(0, 4.6, 0);
    this.roof = inst(roof, new THREE.MeshStandardMaterial({ color: 0xb3412f }), MAX_HOUSES);
  }

  /** The track and towns stay clear of trees and houses. */
  setTrack(graph: TrackGraph, track: Track) {
    this.trackGrid.clear();
    for (const { p } of graph.samples(2)) {
      const key = `${Math.floor(p.x / GRID)},${Math.floor(p.z / GRID)}`;
      const list = this.trackGrid.get(key) ?? [];
      list.push(p);
      this.trackGrid.set(key, list);
    }
    this.towns = track.stations.map((s) => graph.nodes.get(s.node)?.p).filter((p): p is THREE.Vector3 => !!p);
    this.cells.clear();
    this.shownAt = null;
  }

  private nearTrack(x: number, z: number, d: number) {
    const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID), r = Math.ceil(d / GRID);
    for (let i = gx - r; i <= gx + r; i++)
      for (let k = gz - r; k <= gz + r; k++)
        for (const p of this.trackGrid.get(`${i},${k}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < d) return true;
    return false;
  }

  private free(x: number, z: number, room: number) {
    return this.towns.every((t) => Math.hypot(t.x - x, t.z - z) > TOWN_ROOM) && !this.nearTrack(x, z, room);
  }

  /** What grows in cell (cx, cz): the same every time. */
  private cell(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    const hit = this.cells.get(key);
    if (hit) return hit;
    const x0 = cx * CELL, z0 = cz * CELL;
    const houses: House[] = [];
    if (hash(cx, cz, 1) < 0.035) {
      // A farmhouse, kept off the cell's edges so it never meets the neighbours' trees.
      const x = x0 + 8 + hash(cx, cz, 2) * (CELL - 16), z = z0 + 8 + hash(cx, cz, 3) * (CELL - 16);
      if (this.free(x, z, TRACK_ROOM_HOUSE)) houses.push({ x, z, rot: hash(cx, cz, 4) * Math.PI });
    }
    // Forests where the large-scale noise is high, meadows with a few trees elsewhere.
    const cxm = x0 + CELL / 2, czm = z0 + CELL / 2;
    const forest = Math.max(0, noise(cxm, czm, 180, 5) * 2 - 0.95);
    const leafyArea = noise(cxm, czm, 260, 6) > 0.5;
    const n = Math.floor((0.06 + forest * 1.5) * 14 + hash(cx, cz, 7) * 1.5);
    const trees: Tree[] = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + hash(cx, cz, 10 + i * 4) * CELL, z = z0 + hash(cx, cz, 11 + i * 4) * CELL;
      if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 7)) continue;
      if (!this.free(x, z, TRACK_ROOM_TREE)) continue;
      const r = hash(cx, cz, 12 + i * 4);
      trees.push({ x, z, scale: 0.65 + hash(cx, cz, 13 + i * 4) * 0.85, leafy: leafyArea ? r < 0.75 : r < 0.2 });
    }
    const out = { trees, houses };
    if (this.cells.size > 6000) this.cells.clear();
    this.cells.set(key, out);
    return out;
  }

  /** Shows the cells around `focus`; cheap when the focus stays in the same cell. */
  update(focus: THREE.Vector3) {
    const fx = Math.floor(focus.x / CELL), fz = Math.floor(focus.z / CELL);
    const at = `${fx},${fz}`;
    if (at === this.shownAt) return;
    this.shownAt = at;
    const r = Math.ceil(VIEW / CELL);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let nt = 0, nc = 0, nb = 0, nh = 0;
    for (let i = -r; i <= r; i++) {
      for (let k = -r; k <= r; k++) {
        if ((i * i + k * k) * CELL * CELL > (VIEW + CELL) ** 2) continue;
        const c = this.cell(fx + i, fz + k);
        for (const t of c.trees) {
          if (nt >= MAX_TREES) break;
          pos.set(t.x, 0, t.z);
          scl.setScalar(t.scale);
          m.compose(pos, q.identity(), scl);
          this.trunk.setMatrixAt(nt++, m);
          if (t.leafy) this.ball.setMatrixAt(nb++, m);
          else this.cone.setMatrixAt(nc++, m);
        }
        for (const h of c.houses) {
          if (nh >= MAX_HOUSES) break;
          q.setFromAxisAngle(up, h.rot);
          m.compose(pos.set(h.x, 0, h.z), q, scl.setScalar(1));
          this.body.setMatrixAt(nh, m);
          this.roof.setMatrixAt(nh++, m);
        }
      }
    }
    const done = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    };
    done(this.trunk, nt);
    done(this.cone, nc);
    done(this.ball, nb);
    done(this.body, nh);
    done(this.roof, nh);
  }

  dispose() {
    for (const m of [this.trunk, this.cone, this.ball, this.body, this.roof]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
