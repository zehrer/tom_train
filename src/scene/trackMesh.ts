import * as THREE from "three";
import type { Switches, Track, TrackGraph } from "../model/track";

/** Height of the rail tops above the track bed. Vehicles stand on this. */
export const RAIL_TOP = 0.5;
const GAUGE = 1.2;
const PLATFORM = 18;
const Y = new THREE.Vector3(0, 1, 0);

type Profile = [side: number, up: number][];

/**
 * Sweeps a 2D profile (side, up) along an edge from s0 to s1. Each profile edge gets its own
 * vertices so the edges stay sharp while the surface is smooth along the curve.
 */
function sweep(graph: TrackGraph, edge: number, step: number, profile: Profile, s0 = 0, s1 = graph.edges[edge].length) {
  const n = Math.max(1, Math.round(Math.abs(s1 - s0) / step));
  const ss = Array.from({ length: n + 1 }, (_, i) => {
    const s = s0 + ((s1 - s0) * i) / n;
    return { p: graph.pointOn(edge, s), t: graph.tangentOn(edge, s) };
  });
  const pos: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3();
  for (let e = 0; e < profile.length; e++) {
    const a = profile[e], b = profile[(e + 1) % profile.length];
    const base = pos.length / 3;
    for (const { p, t } of ss) {
      side.set(-t.z, 0, t.x).normalize();
      pos.push(p.x + side.x * a[0], p.y + a[1], p.z + side.z * a[0]);
      pos.push(p.x + side.x * b[0], p.y + b[1], p.z + side.z * b[0]);
    }
    for (let i = 0; i < ss.length - 1; i++) {
      const v = base + i * 2;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const mats = {
  ballast: new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 1, side: THREE.DoubleSide }),
  sleeper: new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
  pillar: new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.9 }),
  platform: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 }),
  edge: new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xd93025, roughness: 0.7 }),
  post: new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.6 }),
  buffer: new THREE.MeshStandardMaterial({ color: 0xc5221f, roughness: 0.6 }),
  stationHouse: new THREE.MeshStandardMaterial({ color: 0xf3dfc1, roughness: 0.9 }),
  house: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
  houseRoof: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
  route: new THREE.MeshStandardMaterial({ color: 0xfbbc04, emissive: 0xfbbc04, emissiveIntensity: 0.5, side: THREE.DoubleSide }),
  lever: new THREE.MeshStandardMaterial({ color: 0x202124, roughness: 0.6 }),
};

const WALLS = [0xf5efe3, 0xf3dfc1, 0xe8eef2, 0xf6e7a8, 0xe9d3cf, 0xdfe8d5];
const ROOFS = [0xb3412f, 0x8c3b2a, 0x5f6368, 0xa0522d];

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}

/** Group placed at p, its +z along t, +x to the left. */
export function frameAt(p: THREE.Vector3, t: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(p);
  g.rotation.y = Math.atan2(t.x, t.z);
  return g;
}

function box(g: THREE.Group, size: [number, number, number], mat: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

/** Builds the track bed, sleepers, rails, bridge pillars, buffer stops and the towns. */
export function buildTrack(graph: TrackGraph, track: Track) {
  const group = new THREE.Group();
  const shadowed = (m: THREE.Mesh) => ((m.castShadow = true), (m.receiveShadow = true), m);
  // The bed is what a tap or click on the track hits in the editor.
  const beds: THREE.Mesh[] = [];

  for (const e of graph.edges) {
    // The bed reaches below ground so it reads as an embankment on the ground and a deck on bridges.
    const bed = shadowed(new THREE.Mesh(sweep(graph, e.index, 0.8, [[-1.9, -0.6], [1.9, -0.6], [1.45, 0.25], [-1.45, 0.25]]), mats.ballast));
    bed.userData.edge = e.index;
    beds.push(bed);
    group.add(bed);
    for (const s of [-1, 1]) {
      const x = (s * GAUGE) / 2;
      group.add(shadowed(new THREE.Mesh(sweep(graph, e.index, 0.5, [[x - 0.05, 0.37], [x + 0.05, 0.37], [x + 0.05, RAIL_TOP], [x - 0.05, RAIL_TOP]]), mats.rail)));
    }
  }

  const sleepers = graph.samples(0.7);
  const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.12, 0.32), mats.sleeper, sleepers.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  sleepers.forEach(({ p, t }, i) => {
    q.setFromAxisAngle(Y, Math.atan2(t.x, t.z));
    m.compose(new THREE.Vector3(p.x, p.y + 0.31, p.z), q, one);
    sm.setMatrixAt(i, m);
  });
  sm.receiveShadow = true;
  group.add(sm);

  // Pillars under raised track, except where they would stand on a lower track.
  const low = graph.samples(1).filter(({ p }) => p.y < 1.5).map(({ p }) => p);
  const pillars = graph.samples(5).filter(({ p }) => p.y > 0.8 && !low.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < 2.6));
  if (pillars.length) {
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.55, 1, 10), mats.pillar, pillars.length);
    pillars.forEach(({ p }, i) => {
      const h = p.y - 0.6;
      m.compose(new THREE.Vector3(p.x, h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      pm.setMatrixAt(i, m);
    });
    pm.castShadow = true;
    group.add(pm);
  }

  // Buffer stops at every track end, facing outwards.
  for (const n of graph.nodes.values()) {
    if (n.edges.length !== 1) continue;
    const e = graph.edges[n.edges[0]];
    const out = graph.tangentOn(e.index, e.a === n.id ? 0 : e.length);
    if (e.a === n.id) out.negate();
    group.add(bufferStop(n.p.clone().addScaledVector(out, 0.6), out));
  }

  const trackPts = graph.samples(2).map(({ p }) => p);
  const houses: { p: THREE.Vector3; r: number; size: number }[] = [];
  for (const st of track.stations) {
    const n = graph.nodes.get(st.node);
    if (!n) continue;
    group.add(platform(n.p, n.tangent, trackPts));
    group.add(label(st.name, n.p.clone().add(new THREE.Vector3(0, 16, 0))));
    houses.push(...townHouses(n.p, st.name, trackPts, houses));
  }
  if (houses.length) group.add(...houseMeshes(houses));

  return { group, beds, dispose: () => disposeTree(group) };
}

function bufferStop(p: THREE.Vector3, out: THREE.Vector3) {
  const g = frameAt(p, out);
  box(g, [2.2, 0.5, 0.4], mats.buffer, 0, 1.1, 0);
  for (const x of [-0.6, 0.6]) box(g, [0.2, 0.9, 0.2], mats.post, x, 0.7, 0.3);
  return g;
}

/** Platform, canopy and station house on the side of the track with more room. */
function platform(p: THREE.Vector3, tangent: THREE.Vector3, trackPts: THREE.Vector3[]) {
  const g = frameAt(p, tangent);
  const left = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize(); // local +x
  const room = (sign: number) =>
    Math.min(...[-6, 0, 6].map((dz) => {
      const c = p.clone().addScaledVector(left, sign * 6).addScaledVector(tangent, dz);
      return Math.min(...trackPts.map((q) => Math.hypot(q.x - c.x, q.z - c.z)));
    }));
  const side = room(1) > room(-1) + 0.5 ? 1 : -1;
  box(g, [3, 0.9, PLATFORM], mats.platform, side * 3.3, 0.05, 0);
  box(g, [0.25, 0.04, PLATFORM], mats.edge, side * 1.95, 0.52, 0);
  for (const z of [-6, 0, 6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6), mats.post);
    post.position.set(side * 4.1, 1.8, z);
    post.castShadow = true;
    g.add(post);
  }
  box(g, [2.6, 0.15, 14], mats.roof, side * 3.6, 3.15, 0);
  box(g, [5, 3.2, 6], mats.stationHouse, side * 7.6, 1.6, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.2, 4), mats.roof);
  roof.geometry.rotateY(Math.PI / 4);
  roof.scale.set(0.8, 1, 0.95);
  roof.position.set(side * 7.6, 4.3, 0);
  roof.castShadow = true;
  g.add(roof);
  return g;
}

/** The town's name, always facing the camera. */
function label(text: string, at: THREE.Vector3) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "500 44px Roboto, -apple-system, 'Segoe UI', Arial, sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  c.width = w;
  c.height = 72;
  ctx.font = font;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 72, 36);
  ctx.fill();
  ctx.fillStyle = "#1f1f1f";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 24, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sprite.renderOrder = 10;
  sprite.scale.set((0.05 * w) / 72, 0.05, 1);
  sprite.position.copy(at);
  return sprite;
}

function townHouses(center: THREE.Vector3, name: string, trackPts: THREE.Vector3[], taken: { p: THREE.Vector3 }[]) {
  const r = rng(hash(name));
  const out: { p: THREE.Vector3; r: number; size: number }[] = [];
  for (let k = 0; k < 60 && out.length < 16; k++) {
    const a = r() * Math.PI * 2, d = 12 + r() * 26;
    const p = new THREE.Vector3(center.x + Math.cos(a) * d, 0, center.z + Math.sin(a) * d);
    const ok =
      trackPts.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 7) &&
      [...taken, ...out].every((h) => Math.hypot(h.p.x - p.x, h.p.z - p.z) > 7.5);
    if (ok) out.push({ p, r: Math.atan2(center.x - p.x, center.z - p.z) + (r() - 0.5) * 0.6, size: 0.8 + r() * 0.5 });
  }
  return out;
}

function houseMeshes(houses: { p: THREE.Vector3; r: number; size: number }[]) {
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 3.4, 4), mats.house, houses.length);
  const roofGeo = new THREE.ConeGeometry(4.2, 2.4, 4);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.scale(1.25, 1, 1);
  const roof = new THREE.InstancedMesh(roofGeo, mats.houseRoof, houses.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  houses.forEach(({ p, r, size }, i) => {
    q.setFromAxisAngle(Y, r);
    const sc = new THREE.Vector3(size, size * (i % 3 === 0 ? 1.5 : 1), size);
    m.compose(new THREE.Vector3(p.x, 1.7 * sc.y, p.z), q, sc);
    body.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, 3.4 * sc.y + 1.2 * size, p.z), q, new THREE.Vector3(size, size, size));
    roof.setMatrixAt(i, m);
    body.setColorAt(i, color.setHex(WALLS[i % WALLS.length]));
    roof.setColorAt(i, color.setHex(ROOFS[(i * 7) % ROOFS.length]));
  });
  body.castShadow = body.receiveShadow = roof.castShadow = true;
  return [body, roof];
}

/**
 * Shows how every switch is set: a yellow strip on the first metres of the branch it leads to,
 * and a lever beside it. Levers carry userData.switchNode so taps can find them.
 */
export function buildSwitches(graph: TrackGraph, switches: Switches) {
  const group = new THREE.Group();
  const levers: THREE.Object3D[] = [];
  for (const n of graph.nodes.values()) {
    if (!n.branches) continue;
    const state = switches[n.id] ?? 0;
    const edge = graph.edges[n.branches[state]];
    const atA = edge.a === n.id;
    const len = Math.min(10, edge.length * 0.6);
    const strip = new THREE.Mesh(sweep(graph, edge.index, 0.5, [[-0.35, 0.52], [0.35, 0.52]], atA ? 0 : edge.length, atA ? len : edge.length - len), mats.route);
    group.add(strip);

    // Lever on the side away from the diverging branch.
    const div = graph.edges[n.branches[1]];
    const divDir = graph.pointOn(div.index, div.a === n.id ? Math.min(8, div.length) : div.length - Math.min(8, div.length)).sub(n.p);
    const left = new THREE.Vector3(n.tangent.z, 0, -n.tangent.x).normalize();
    const side = divDir.dot(left) > 0 ? -1 : 1;
    const lever = frameAt(n.p.clone().addScaledVector(left, side * 3), n.tangent);
    box(lever, [0.9, 0.5, 0.9], mats.lever, 0, 0.35, 0);
    const handle = box(lever, [0.18, 1.6, 0.18], state ? mats.route : mats.buffer, 0, 1.1, 0);
    handle.rotation.z = (state ? -1 : 1) * side * 0.5;
    // A larger invisible target makes the lever easy to tap.
    const target = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    target.position.y = 1;
    lever.add(target);
    lever.traverse((o) => (o.userData.switchNode = n.id));
    levers.push(lever);
    group.add(lever);
  }
  return { group, levers, dispose: () => disposeTree(group) };
}

/** A light signal at the right of the track for trains running along `travel`. */
export class Signal {
  readonly group: THREE.Group;
  private red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 0 });
  private green = new THREE.MeshStandardMaterial({ color: 0x003000, emissive: 0x20ff40, emissiveIntensity: 0 });
  private state: boolean | null = null;

  constructor(p: THREE.Vector3, travel: THREE.Vector3) {
    this.group = frameAt(p, travel);
    const g = this.group;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2), mats.post);
    mast.position.set(-2.2, 2.1, 0);
    mast.castShadow = true;
    g.add(mast);
    box(g, [0.6, 1.3, 0.4], mats.lever, -2.2, 4.4, 0);
    const lamp = new THREE.SphereGeometry(0.2, 12, 8);
    const r = new THREE.Mesh(lamp, this.red);
    r.position.set(-2.2, 4.75, -0.22); // facing the approaching driver
    const gr = new THREE.Mesh(lamp, this.green);
    gr.position.set(-2.2, 4.1, -0.22);
    g.add(r, gr);
    this.set(false);
  }

  set(clear: boolean) {
    if (clear === this.state) return;
    this.state = clear;
    this.red.emissiveIntensity = clear ? 0 : 2.5;
    this.green.emissiveIntensity = clear ? 2.5 : 0;
    this.red.color.setHex(clear ? 0x400000 : 0xff3020);
    this.green.color.setHex(clear ? 0x30ff50 : 0x003000);
  }

  dispose() {
    disposeTree(this.group);
    this.red.dispose();
    this.green.dispose();
  }
}
