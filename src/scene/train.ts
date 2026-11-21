import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TrainType } from "../model/trains";

export interface Car {
  group: THREE.Group;
  /** Length over buffers. */
  length: number;
  /** Distance from the center to each bogie. */
  half: number;
  wheels: { mesh: THREE.Mesh; radius: number }[];
  /** Driver's seat (car coordinates) when this car leads: front = normal running, back = when pushed. */
  cab?: { front?: THREE.Vector3; back?: THREE.Vector3 };
}

export interface TrainModel {
  cars: Car[];
  length: number;
  /** Chimney or exhaust on the first car. */
  exhaust: { at: THREE.Vector3; color: number; rate: (kmh: number) => number } | null;
}

export const CAR_GAP = 0.5;

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

const M = {
  black: std(0x202124, { roughness: 0.7 }),
  dark: std(0x3c4043, { roughness: 0.6 }),
  red: std(0xc5221f),
  white: std(0xf8f9fa, { roughness: 0.35 }),
  cream: std(0xf3e9d2),
  orange: std(0xe37400),
  yellow: std(0xfbbc04),
  gold: std(0xf2c94c, { metalness: 0.6, roughness: 0.3 }),
  steel: std(0x9aa0a6, { metalness: 0.6, roughness: 0.4 }),
  glass: std(0x9fc8e8, { roughness: 0.1, metalness: 0.3 }),
  darkGlass: std(0x263238, { roughness: 0.15, metalness: 0.4 }),
  coal: std(0x111111, { roughness: 1 }),
  wood: std(0x8d5b3a, { roughness: 0.9 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 0.8 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, side: THREE.DoubleSide }),
};

const colorCache = new Map<number, THREE.Material>();
const paint = (c: number) => colorCache.get(c) ?? (colorCache.set(c, std(c)), colorCache.get(c)!);

/**
 * Collects a car's parts and merges them into one mesh per material: a 20-train layout stays at a
 * few thousand draw calls. Axles stay separate so their wheels can turn.
 */
class Builder {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly group = new THREE.Group();
  /** Parts go in here; turned around for a car that runs backwards (the rear power car). */
  private inner = new THREE.Group();
  readonly wheels: Car["wheels"] = [];

  constructor(reversed = false) {
    this.group.add(this.inner);
    if (reversed) this.inner.rotation.y = Math.PI;
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    const list = this.parts.get(mat) ?? [];
    list.push(geo);
    this.parts.set(mat, list);
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx);
  }

  /** A pair of wheels on one axle. */
  axles(zs: number[], radius: number) {
    for (const z of zs) {
      const mesh = new THREE.Mesh(axleGeometry(radius), [M.black, M.steel]);
      mesh.position.set(0, radius, z);
      mesh.castShadow = true;
      mesh.userData.shared = true;
      this.inner.add(mesh);
      this.wheels.push({ mesh, radius });
    }
  }

  car(length: number, half: number, cab?: Car["cab"]): Car {
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.inner.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    return { group: this.group, length, half, wheels: this.wheels, cab };
  }
}

const axleCache = new Map<number, THREE.BufferGeometry>();
function axleGeometry(radius: number) {
  const hit = axleCache.get(radius);
  if (hit) return hit;
  const wheels: THREE.BufferGeometry[] = [];
  const spokes: THREE.BufferGeometry[] = [];
  for (const x of [-0.68, 0.68]) {
    const w = new THREE.CylinderGeometry(radius, radius, 0.18, 18);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0, 0);
    wheels.push(w);
    // A spoke marks the rotation.
    const s = new THREE.BoxGeometry(0.2, radius * 1.7, 0.12);
    s.translate(x + Math.sign(x) * 0.1, 0, 0);
    spokes.push(s);
  }
  const geo = mergeGeometries([mergeGeometries(wheels), mergeGeometries(spokes)], true);
  axleCache.set(radius, geo);
  return geo;
}

/** Frees a car's own geometry (shared axles stay). */
export function disposeCar(car: Car) {
  car.group.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose();
  });
}

// --- Locomotives and power cars (+z is forward, y = 0 is the rail top) ----------------------

function steamLoco(): Car {
  const b = new Builder();
  b.box(1.9, 0.35, 6, M.black, 0, 1.05, 0);
  b.add(new THREE.CylinderGeometry(0.78, 0.78, 3.6, 24), M.red, 0, 1.95, 0.9, Math.PI / 2);
  b.add(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 24), M.gold, 0, 1.95, 2.72, Math.PI / 2);
  b.add(new THREE.CylinderGeometry(0.72, 0.72, 0.15, 24), M.black, 0, 1.95, 2.8, Math.PI / 2);
  b.add(new THREE.CylinderGeometry(0.3, 0.22, 1.0, 14), M.black, 0, 3.1, 2.1);
  b.add(new THREE.CylinderGeometry(0.4, 0.3, 0.15, 14), M.black, 0, 3.62, 2.1);
  b.add(new THREE.SphereGeometry(0.36, 16, 10), M.gold, 0, 2.75, 0.7);
  // Cab with side windows (none at the front: that's where the driver looks out).
  b.box(2.1, 2.0, 1.9, M.red, 0, 2.2, -1.95);
  b.box(2.4, 0.14, 2.3, M.black, 0, 3.27, -1.95);
  for (const x of [-1.06, 1.06]) b.box(0.02, 0.6, 0.9, M.glass, x, 2.65, -1.9);
  b.box(2.0, 0.35, 0.2, M.red, 0, 1.0, 3.05);
  b.add(new THREE.SphereGeometry(0.16, 12, 8), M.lamp, 0, 1.45, 3.1);
  b.axles([1.9, 0.5, -0.9], 0.55);
  b.axles([-2.4], 0.38);
  return b.car(6.4, 2.0, { front: new THREE.Vector3(-0.6, 3.0, -1.4) });
}

/** A diesel road-switcher: long hood behind a cab near the front, short nose ahead of it. */
function dieselLoco(): Car {
  const b = new Builder();
  b.box(2.0, 0.4, 8.6, M.dark, 0, 1.1, 0);
  b.box(2.1, 0.25, 8.8, M.yellow, 0, 1.4, 0);
  // Long hood with grilles and the exhaust.
  b.box(1.7, 1.55, 5.0, M.orange, 0, 2.3, -1.4);
  for (const x of [-0.86, 0.86]) for (const z of [-3.2, -2.2, -1.2, -0.2]) b.box(0.03, 0.9, 0.6, M.dark, x, 2.35, z);
  b.box(0.45, 0.35, 0.7, M.dark, 0, 3.2, -0.9);
  // Cab (open at the front, so the driver can see) and short nose below the window line.
  b.box(2.15, 2.2, 1.9, M.orange, 0, 2.6, 2.05);
  b.box(2.3, 0.15, 2.1, M.dark, 0, 3.75, 2.05);
  for (const x of [-1.08, 1.08]) b.box(0.03, 0.7, 1.2, M.glass, x, 3.05, 2.1);
  b.box(1.5, 1.1, 1.2, M.orange, 0, 2.05, 3.6);
  b.box(2.0, 0.3, 0.25, M.yellow, 0, 1.2, 4.35);
  b.add(new THREE.SphereGeometry(0.15, 12, 8), M.lamp, 0, 2.65, 4.21);
  b.axles([3.1, 2.1, -2.1, -3.1], 0.42);
  return b.car(9.0, 2.6, { front: new THREE.Vector3(-0.55, 3.15, 2.1) });
}

/** An electric locomotive with cabs at both ends and a pantograph. */
function electricLoco(): Car {
  const b = new Builder();
  b.box(2.0, 0.4, 7.8, M.dark, 0, 1.0, 0);
  b.box(2.25, 2.3, 7.6, M.red, 0, 2.35, 0);
  b.box(2.27, 0.25, 7.62, M.white, 0, 1.55, 0);
  b.box(2.0, 0.2, 7.2, M.steel, 0, 3.6, 0);
  for (const z of [-3.1, 3.1]) for (const x of [-1.13, 1.13]) b.box(0.03, 0.75, 1.1, M.glass, x, 2.85, z);
  for (const x of [-1.13, 1.13]) b.box(0.03, 0.5, 3.2, M.darkGlass, x, 2.85, 0);
  // Pantograph: base, two arms, contact bar.
  b.box(1.2, 0.15, 1.2, M.dark, 0, 3.78, 1.6);
  b.box(0.08, 0.08, 1.6, M.steel, 0, 4.25, 1.15, -0.65);
  b.box(0.08, 0.08, 1.6, M.steel, 0, 4.25, 2.05, 0.65);
  b.box(1.5, 0.08, 0.15, M.steel, 0, 4.75, 1.6);
  for (const z of [-3.9, 3.9]) {
    b.box(2.1, 0.3, 0.2, M.dark, 0, 1.0, z);
    b.add(new THREE.SphereGeometry(0.14, 12, 8), M.lamp, 0, 1.8, z + Math.sign(z) * 0.02);
  }
  b.axles([2.6, 1.6, -1.6, -2.6], 0.45);
  return b.car(8.2, 2.1, { front: new THREE.Vector3(-0.55, 3.0, 3.1) });
}

/** Power car of the high-speed train; `rear` turns it around to close the train at the back. */
function powerCar(rear: boolean): Car {
  const b = new Builder(rear);
  b.box(2.0, 0.4, 9.0, M.dark, 0, 1.0, -0.6);
  b.box(2.3, 2.4, 8.0, M.white, 0, 2.3, -1.0);
  b.box(2.32, 0.3, 8.02, M.red, 0, 1.55, -1.0);
  b.box(2.0, 0.2, 7.2, M.steel, 0, 3.6, -1.2);
  // Nose: low front part and a sloped windscreen. The screen is one-sided, so it is see-through from the cab.
  b.box(2.3, 1.3, 2.4, M.white, 0, 1.75, 4.1);
  b.box(2.32, 0.3, 2.42, M.red, 0, 1.55, 4.1);
  const screen = new THREE.PlaneGeometry(2.2, 2.1);
  b.add(screen, M.darkGlass, 0, 2.95, 4.0, -0.95);
  for (const x of [-1.1, 1.1]) {
    const side = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 2.4, 5.3), new THREE.Vector3(0, 3.5, 3.0), new THREE.Vector3(0, 2.4, 3.0),
    ]);
    side.setIndex(x > 0 ? [0, 1, 2] : [0, 2, 1]);
    side.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1], 2));
    side.computeVertexNormals();
    b.add(side, M.white, x, 0, 0);
  }
  b.add(new THREE.SphereGeometry(0.13, 12, 8), M.lamp, -0.7, 1.75, 5.32);
  b.add(new THREE.SphereGeometry(0.13, 12, 8), M.lamp, 0.7, 1.75, 5.32);
  for (const x of [-1.16, 1.16]) b.box(0.03, 0.5, 1.6, M.darkGlass, x, 2.9, 2.0);
  b.axles([3.0, 2.0, -3.0, -4.0], 0.45);
  const seat = new THREE.Vector3(-0.55, 3.0, 3.1);
  return b.car(10.8, 3.0, rear ? { back: new THREE.Vector3(0.55, 3.0, -3.1) } : { front: seat });
}

// --- Wagons and coaches ------------------------------------------------------------------------

export const WAGON_COLORS = [0x0b57d0, 0x188038, 0xe37400, 0x9334e6, 0x12b5cb, 0xd93025];

function coveredWagon(color: number): Car {
  const b = new Builder();
  b.box(1.9, 0.3, 5.2, M.black, 0, 0.9, 0);
  b.box(2.2, 1.7, 4.8, paint(color), 0, 1.9, 0);
  // An arc of a cylinder lying along z; θ = π is its top after the rotation.
  b.add(new THREE.CylinderGeometry(1.5, 1.5, 5.0, 24, 1, true, Math.PI - 0.8, 1.6), M.roof, 0, 1.7, 0, Math.PI / 2);
  b.box(2.24, 1.3, 1.4, M.wood, 0, 1.85, 0);
  b.axles([1.7, -1.7], 0.4);
  return b.car(5.6, 1.7);
}

function coalWagon(color: number): Car {
  const b = new Builder();
  const c = paint(color);
  b.box(1.9, 0.3, 5.2, M.black, 0, 0.9, 0);
  b.box(2.2, 0.15, 4.8, c, 0, 1.1, 0);
  for (const x of [-1.05, 1.05]) b.box(0.1, 1.0, 4.8, c, x, 1.65, 0);
  for (const z of [-2.35, 2.35]) b.box(2.2, 1.0, 0.1, c, 0, 1.65, z);
  b.box(2.0, 0.5, 4.6, M.coal, 0, 1.75, 0);
  b.axles([1.7, -1.7], 0.4);
  return b.car(5.6, 1.7);
}

function tankWagon(color: number): Car {
  const b = new Builder();
  b.box(1.9, 0.3, 6.6, M.black, 0, 0.9, 0);
  b.add(new THREE.CylinderGeometry(1.0, 1.0, 6.0, 24), paint(color), 0, 2.05, 0, Math.PI / 2);
  for (const z of [-3.0, 3.0]) b.add(new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), paint(color), 0, 2.05, z, Math.sign(z) * Math.PI / 2);
  b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16), M.dark, 0, 3.1, 0);
  for (const z of [-1.6, 1.6]) b.box(2.1, 0.2, 0.25, M.dark, 0, 1.15, z);
  b.axles([2.4, -2.4], 0.4);
  return b.car(7.6, 2.4);
}

function containerWagon(color: number): Car {
  const b = new Builder();
  b.box(2.0, 0.3, 7.4, M.dark, 0, 0.95, 0);
  b.box(2.2, 2.0, 6.6, paint(color), 0, 2.15, 0);
  for (let z = -3.0; z <= 3.01; z += 0.6) for (const x of [-1.11, 1.11]) b.box(0.03, 1.8, 0.12, M.dark, x, 2.15, z);
  b.axles([2.8, 2.0, -2.0, -2.8], 0.38);
  return b.car(7.8, 2.4);
}

function coach(color: number, last: boolean): Car {
  const b = new Builder();
  const c = paint(color);
  b.box(2.0, 0.35, 8.4, M.dark, 0, 0.95, 0);
  b.box(2.2, 2.1, 8.2, c, 0, 2.2, 0);
  b.box(2.22, 0.35, 8.22, M.cream, 0, 1.5, 0);
  b.add(new THREE.CylinderGeometry(1.6, 1.6, 8.2, 24, 1, true, Math.PI - 0.75, 1.5), M.roof, 0, 2.15, 0, Math.PI / 2);
  for (const x of [-1.11, 1.11]) for (const z of [-3.0, -1.5, 0, 1.5, 3.0]) b.box(0.03, 0.6, 1.1, M.darkGlass, x, 2.65, z);
  b.axles([3.2, 2.4, -2.4, -3.2], 0.38);
  // Pushed trains: the driver sits at the end of the last coach.
  return b.car(8.8, 2.8, last ? { back: new THREE.Vector3(0.55, 2.9, -3.9) } : undefined);
}

function expressCar(): Car {
  const b = new Builder();
  b.box(2.0, 0.35, 9.4, M.dark, 0, 0.95, 0);
  b.box(2.3, 2.4, 9.4, M.white, 0, 2.3, 0);
  b.box(2.32, 0.3, 9.42, M.red, 0, 1.55, 0);
  b.box(2.0, 0.2, 9.0, M.steel, 0, 3.6, 0);
  for (const x of [-1.16, 1.16]) b.box(0.03, 0.55, 8.4, M.darkGlass, x, 2.75, 0);
  b.axles([3.8, 3.0, -3.0, -3.8], 0.4);
  return b.car(9.8, 3.4);
}

// --- Whole trains ------------------------------------------------------------------------------

const lastBack = (cars: Car[]) => {
  const last = cars[cars.length - 1];
  if (!last.cab?.back) last.cab = { ...last.cab, back: new THREE.Vector3(0.6, 3.5, -last.length / 2 + 0.4) };
  return cars;
};

export function buildTrain(type: TrainType, wagons: number, seed = 0): TrainModel {
  const color = (i: number) => WAGON_COLORS[(i + seed) % WAGON_COLORS.length];
  let cars: Car[];
  let exhaust: TrainModel["exhaust"] = null;
  switch (type) {
    case "diesel":
      cars = [dieselLoco(), ...Array.from({ length: wagons }, (_, i) => [tankWagon, containerWagon, coalWagon][i % 3](color(i)))];
      exhaust = { at: new THREE.Vector3(0, 3.5, -0.9), color: 0x5f6368, rate: (kmh) => 0.6 + kmh / 25 };
      break;
    case "electric": {
      const c = [0x0b57d0, 0x188038, 0xc5221f][seed % 3];
      cars = [electricLoco(), ...Array.from({ length: wagons }, (_, i) => coach(c, i === wagons - 1))];
      break;
    }
    case "express":
      cars = [powerCar(false), ...Array.from({ length: wagons }, expressCar), powerCar(true)];
      break;
    default:
      cars = [steamLoco(), ...Array.from({ length: wagons }, (_, i) => (i % 2 ? coalWagon : coveredWagon)(color(i)))];
      exhaust = { at: new THREE.Vector3(0, 3.7, 2.1), color: 0xf1f3f4, rate: (kmh) => 1.5 + kmh / 6 };
  }
  lastBack(cars);
  const length = cars.reduce((sum, c) => sum + c.length, 0) + CAR_GAP * (cars.length - 1);
  return { cars, length, exhaust };
}

/** Puffs of steam or exhaust rising from the loco. */
export class Smoke {
  readonly group = new THREE.Group();
  private puffs: { mesh: THREE.Mesh; age: number; vel: THREE.Vector3 }[] = [];
  private next = 0;
  private acc = 0;
  private static geo = new THREE.SphereGeometry(0.45, 10, 8);

  constructor(color = 0xf1f3f4, count = 28) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(Smoke.geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, age: 99, vel: new THREE.Vector3() });
    }
  }

  update(dt: number, from: THREE.Vector3, rate: number) {
    this.acc += dt * rate;
    while (this.acc > 1) {
      this.acc -= 1;
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % this.puffs.length;
      p.age = 0;
      p.mesh.position.copy(from);
      p.vel.set((Math.random() - 0.5) * 0.6, 2.2 + Math.random(), (Math.random() - 0.5) * 0.6);
      p.mesh.visible = true;
    }
    for (const p of this.puffs) {
      if (p.age > 2.5) {
        p.mesh.visible = false;
        continue;
      }
      p.age += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.mesh.scale.setScalar(0.5 + p.age * 0.75);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.45 * (1 - p.age / 2.5));
    }
  }

  dispose() {
    for (const p of this.puffs) (p.mesh.material as THREE.Material).dispose();
  }
}
