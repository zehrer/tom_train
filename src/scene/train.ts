import * as THREE from "three";

export interface Car {
  group: THREE.Group;
  /** Length over buffers. */
  length: number;
  /** Distance from the center to each bogie. */
  half: number;
  wheels: { mesh: THREE.Mesh; radius: number }[];
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

const M = {
  black: std(0x202124, { roughness: 0.7 }),
  red: std(0xc5221f),
  gold: std(0xf2c94c, { metalness: 0.6, roughness: 0.3 }),
  steel: std(0x9aa0a6, { metalness: 0.6, roughness: 0.4 }),
  glass: std(0xbfe3ff, { roughness: 0.1, metalness: 0.2 }),
  coal: std(0x111111, { roughness: 1 }),
  wood: std(0x8d5b3a, { roughness: 0.9 }),
};

function part(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function wheelSet(group: THREE.Group, zs: number[], radius: number, wheels: Car["wheels"]) {
  const geo = new THREE.CylinderGeometry(radius, radius, 0.18, 18);
  geo.rotateZ(Math.PI / 2);
  for (const z of zs) {
    for (const x of [-0.68, 0.68]) {
      const mesh = part(group, geo, M.black, x, radius, z);
      // A spoke marks the rotation.
      mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, radius * 1.7, 0.12), M.steel));
      wheels.push({ mesh, radius });
    }
  }
}

/** A small steam locomotive; +z is forward, y = 0 is the rail top. */
export function makeLoco(): Car {
  const g = new THREE.Group();
  const wheels: Car["wheels"] = [];
  part(g, new THREE.BoxGeometry(1.9, 0.35, 6), M.black, 0, 1.05, 0);
  part(g, new THREE.CylinderGeometry(0.78, 0.78, 3.6, 24), M.red, 0, 1.95, 0.9, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.8, 0.8, 0.12, 24), M.gold, 0, 1.95, 2.72, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.72, 0.72, 0.15, 24), M.black, 0, 1.95, 2.8, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.3, 0.22, 1.0, 14), M.black, 0, 3.1, 2.1);
  part(g, new THREE.CylinderGeometry(0.4, 0.3, 0.15, 14), M.black, 0, 3.62, 2.1);
  part(g, new THREE.SphereGeometry(0.36, 16, 10), M.gold, 0, 2.75, 0.7);
  // Cab with windows.
  part(g, new THREE.BoxGeometry(2.1, 2.0, 1.9), M.red, 0, 2.2, -1.95);
  part(g, new THREE.BoxGeometry(2.4, 0.14, 2.3), M.black, 0, 3.27, -1.95);
  for (const x of [-1.06, 1.06]) part(g, new THREE.BoxGeometry(0.02, 0.6, 0.9), M.glass, x, 2.65, -1.9);
  // Buffer beam and lamp.
  part(g, new THREE.BoxGeometry(2.0, 0.35, 0.2), M.red, 0, 1.0, 3.05);
  part(g, new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 0.8 }), 0, 1.45, 3.1);
  wheelSet(g, [1.9, 0.5, -0.9], 0.55, wheels);
  wheelSet(g, [-2.4], 0.38, wheels);
  return { group: g, length: 6.4, half: 2.0, wheels };
}

export const WAGON_COLORS = [0x0b57d0, 0x188038, 0xe37400, 0x9334e6, 0x12b5cb, 0xd93025];

export function makeWagon(i: number): Car {
  const g = new THREE.Group();
  const wheels: Car["wheels"] = [];
  const color = std(WAGON_COLORS[i % WAGON_COLORS.length]);
  part(g, new THREE.BoxGeometry(1.9, 0.3, 5.2), M.black, 0, 0.9, 0);
  if (i % 2 === 0) {
    // Covered goods wagon.
    part(g, new THREE.BoxGeometry(2.2, 1.7, 4.8), color, 0, 1.9, 0);
    // An arc of a cylinder lying along z; θ = π is its top after the rotation.
    const roof = new THREE.CylinderGeometry(1.5, 1.5, 5.0, 24, 1, true, Math.PI - 0.8, 1.6);
    part(g, roof, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, side: THREE.DoubleSide }), 0, 1.7, 0, Math.PI / 2);
    part(g, new THREE.BoxGeometry(2.24, 1.3, 1.4), M.wood, 0, 1.85, 0);
  } else {
    // Open wagon with a coal load.
    part(g, new THREE.BoxGeometry(2.2, 0.15, 4.8), color, 0, 1.1, 0);
    for (const x of [-1.05, 1.05]) part(g, new THREE.BoxGeometry(0.1, 1.0, 4.8), color, x, 1.65, 0);
    for (const z of [-2.35, 2.35]) part(g, new THREE.BoxGeometry(2.2, 1.0, 0.1), color, 0, 1.65, z);
    part(g, new THREE.BoxGeometry(2.0, 0.5, 4.6), M.coal, 0, 1.75, 0);
  }
  wheelSet(g, [1.7, -1.7], 0.4, wheels);
  return { group: g, length: 5.6, half: 1.7, wheels };
}

/** Puffs of steam rising from the chimney. */
export class Smoke {
  readonly group = new THREE.Group();
  private puffs: { mesh: THREE.Mesh; age: number; vel: THREE.Vector3 }[] = [];
  private next = 0;
  private acc = 0;

  constructor(count = 36) {
    const geo = new THREE.SphereGeometry(0.45, 10, 8);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf1f3f4, transparent: true, opacity: 0, depthWrite: false }));
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
      if (p.age > 2.5) { p.mesh.visible = false; continue; }
      p.age += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.mesh.scale.setScalar(0.5 + p.age * 0.75);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.45 * (1 - p.age / 2.5));
    }
  }
}
