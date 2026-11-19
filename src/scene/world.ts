import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Driver } from "../model/drive";
import { dragPoint, select, useStore, type State } from "../model/store";
import { TrackPath, type Track } from "../model/track";
import { buildTrack, RAIL_TOP, rng, Signal } from "./trackMesh";
import { makeLoco, makeWagon, Smoke, type Car } from "./train";

const GAP = 0.5;
const SUN_OFFSET = new THREE.Vector3(50, 90, 35);

/** Owns the three.js scene; reads the store every frame and reports live values back. */
export class World {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private last = performance.now();
  private frame = 0;
  private resize: ResizeObserver;

  private trackRef: Track | null = null;
  private path!: TrackPath;
  private trackMesh: ReturnType<typeof buildTrack> | null = null;
  private bounds = { center: new THREE.Vector3(), radius: 60 };
  private conflicts = new THREE.Group();
  private handles = new THREE.Group();
  private handleRefs: { track: Track | null; selected: number | null } = { track: null, selected: null };
  private signals: { signal: Signal; stop: number; dir: 1 | -1; s: number }[] = [];

  private trees: { trunk: THREE.InstancedMesh; crown: THREE.InstancedMesh; spots: THREE.Vector3[] };
  private houses: { body: THREE.InstancedMesh; roof: THREE.InstancedMesh; spots: { p: THREE.Vector3; r: number }[] };

  private cars: Car[] = [];
  private trainLength = 0;
  private trainGroup = new THREE.Group();
  private wagonCount = -1;
  private driver: Driver | null = null;
  private smoke = new Smoke();
  private distance = 0;
  private lastLive = 0;

  private lastCam: string | null = null;
  private lookAt = new THREE.Vector3();
  private dragging: number | null = null;
  private downAt: { x: number; y: number } | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0xcfe5fb);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 220, 560);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x6f8f4e, 1.6));
    // The sun's shadow area follows what the camera looks at, so long lines keep their shadows.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 260 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 64), new THREE.MeshStandardMaterial({ color: 0x8dbb62, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.trees = this.makeTrees();
    this.houses = this.makeHouses();
    this.scene.add(this.trainGroup, this.smoke.group, this.conflicts, this.handles);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 400;

    const el = this.renderer.domElement;
    // Capture phase: a grabbed point must win over the orbit controls on the same canvas.
    el.addEventListener("pointerdown", this.onDown, { capture: true });
    el.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);

    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(host);
    this.onResize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onResize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const st = useStore.getState();
    const trackChanged = st.track !== this.trackRef;
    const wagonsChanged = st.wagons !== this.wagonCount;
    if (trackChanged) this.setTrack(st.track);
    if (wagonsChanged) this.setWagons(st.wagons);
    if (trackChanged || wagonsChanged) this.syncDriver(st.track);
    this.updateHandles(st);
    this.updateTrain(st, dt);
    this.updateCamera(st, dt);
    this.renderer.render(this.scene, this.camera);
  };

  // --- Track and scenery -------------------------------------------------------------------

  private setTrack(track: Track) {
    this.trackRef = track;
    this.path = new TrackPath(track);
    if (this.trackMesh) {
      this.scene.remove(this.trackMesh.group);
      this.trackMesh.dispose();
    }
    this.trackMesh = buildTrack(this.path, track);
    this.scene.add(this.trackMesh.group);

    const box = new THREE.Box3().setFromPoints(this.path.samples(4).map(({ p }) => p));
    box.getCenter(this.bounds.center).setY(0);
    const size = box.getSize(new THREE.Vector3());
    this.bounds.radius = Math.max(40, Math.max(size.x, size.z) / 2);

    this.conflicts.clear();
    const ring = new THREE.TorusGeometry(2.2, 0.25, 8, 32);
    ring.rotateX(Math.PI / 2);
    const red = new THREE.MeshBasicMaterial({ color: 0xd93025 });
    for (const p of this.path.conflicts(1.5)) {
      const m = new THREE.Mesh(ring, red);
      m.position.set(p.x, p.y + 1.2, p.z);
      this.conflicts.add(m);
    }
    this.placeScenery(track);
  }

  private makeTrees() {
    const r = rng(7);
    const spots = Array.from({ length: 320 }, () => {
      const a = r() * Math.PI * 2, d = 12 + Math.sqrt(r()) * 220;
      return new THREE.Vector3(Math.cos(a) * d, 0.6 + r() * 0.9, Math.sin(a) * d);
    });
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), new THREE.MeshStandardMaterial({ color: 0x6d4c33 }), spots.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 }), spots.length);
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    this.scene.add(trunk, crown);
    return { trunk, crown, spots };
  }

  private makeHouses() {
    const r = rng(11);
    const spots = Array.from({ length: 14 }, () => {
      const a = r() * Math.PI * 2, d = 40 + r() * 140;
      return { p: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), r: r() * Math.PI };
    });
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 3.4, 4), new THREE.MeshStandardMaterial({ color: 0xf5efe3 }), spots.length);
    const roofGeo = new THREE.ConeGeometry(4.2, 2.4, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.25, 1, 1);
    const roof = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xb3412f }), spots.length);
    body.castShadow = body.receiveShadow = roof.castShadow = true;
    this.scene.add(body, roof);
    return { body, roof, spots };
  }

  /** Hides trees and farmhouses that would stand on the track or in a town. */
  private placeScenery(track: Track) {
    const pts = this.path.samples(2).map(({ p }) => p);
    const towns = track.stations.map((st) => this.path.pointAt(this.path.pointS[st.point]));
    const free = (v: THREE.Vector3, d: number) =>
      towns.every((t) => Math.hypot(v.x - t.x, v.z - t.z) > 40) && pts.every((p) => Math.hypot(p.x - v.x, p.z - v.z) > d);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const { trunk, crown, spots } = this.trees;
    spots.forEach((v, i) => {
      const s = free(v, 4.5) ? v.y : 0;
      m.compose(new THREE.Vector3(v.x, s, v.z), q, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(v.x, s * 3.4, v.z), q, new THREE.Vector3(s, s, s));
      crown.setMatrixAt(i, m);
    });
    trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
    const h = this.houses;
    h.spots.forEach(({ p, r }, i) => {
      const s = free(p, 8) ? 1 : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      m.compose(new THREE.Vector3(p.x, 1.7 * s, p.z), q, new THREE.Vector3(s, s, s));
      h.body.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, 4.6 * s, p.z), q, new THREE.Vector3(s, s, s));
      h.roof.setMatrixAt(i, m);
    });
    h.body.instanceMatrix.needsUpdate = h.roof.instanceMatrix.needsUpdate = true;
  }

  // --- Train and signals -------------------------------------------------------------------

  private setWagons(n: number) {
    this.wagonCount = n;
    this.trainGroup.clear();
    this.cars = [makeLoco(), ...Array.from({ length: n }, (_, i) => makeWagon(i))];
    for (const c of this.cars) this.trainGroup.add(c.group);
    this.trainLength = this.cars.reduce((sum, c) => sum + c.length, 0) + GAP * (this.cars.length - 1);
  }

  private syncDriver(track: Track) {
    if (this.driver) this.driver.setTrack(this.path, track, this.trainLength);
    else this.driver = new Driver(this.path, track, this.trainLength);

    // Exit signals just beyond the front of a train standing at each station, one per direction.
    for (const x of this.signals) {
      this.scene.remove(x.signal.group);
      x.signal.dispose();
    }
    this.signals = [];
    this.driver.stops.forEach((stop, i) => {
      if (stop.station === null) return;
      for (const dir of [1, -1] as const) {
        const s = stop.s + dir * (this.trainLength / 2 + 3);
        if (!this.path.closed && (s < 1 || s > this.path.length - 1)) continue;
        const signal = new Signal(this.path, s, dir);
        this.scene.add(signal.group);
        this.signals.push({ signal, stop: i, dir, s });
      }
    });
  }

  private updateTrain(st: State, dt: number) {
    const d = this.driver!;
    const cruise = st.mode === "simulator" && st.running ? st.speed : 0;
    const ds = d.update(dt, cruise);
    this.distance += Math.abs(ds);

    let at = d.locoS(this.cars[0].length);
    this.cars.forEach((car, i) => {
      if (i > 0) at -= this.cars[i - 1].length / 2 + GAP + car.length / 2;
      this.path.vehiclePose(at, car.half, car.group.position, car.group.quaternion);
      car.group.position.y += RAIL_TOP;
      for (const w of car.wheels) w.mesh.rotation.x += ds / w.radius;
    });

    // A signal is green from shortly before departure until the front of the train has passed it.
    const atStop = d.at ? d.stops.indexOf(d.at) : -1;
    const front = d.mid + (d.dir * this.trainLength) / 2;
    for (const x of this.signals) {
      let ahead = (x.s - front) * x.dir;
      if (this.path.closed) ahead = ((ahead % this.path.length) + this.path.length) % this.path.length;
      x.signal.set(x.stop === atStop && x.dir === d.dir && d.clear && ahead > 0 && ahead < this.trainLength);
    }

    const loco = this.cars[0].group;
    this.smoke.update(dt, loco.localToWorld(new THREE.Vector3(0, 3.7, 2.1)), 1.5 + d.kmh / 6);

    const now = performance.now();
    if (now - this.lastLive > 150) {
      this.lastLive = now;
      const next = d.dwell > 0 ? null : d.next()?.stop;
      useStore.setState({
        live: {
          kmh: Math.round(d.kmh),
          distance: this.distance / (0.6 * 1000),
          at: d.dwell > 0 ? (d.at?.name ?? "End of the line") : null,
          next: next ? (next.name ?? "End of the line") : null,
        },
      });
    }
  }

  // --- Cameras -----------------------------------------------------------------------------

  private updateCamera(st: State, dt: number) {
    const cam = st.mode === "editor" ? "editor" : st.camera;
    const changed = cam !== this.lastCam;
    this.lastCam = cam;
    const orbit = cam === "editor" || cam === "overview";
    this.controls.enabled = orbit && this.dragging === null;
    const near = cam === "cab" ? 0.05 : 0.2;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }

    const d = this.driver!;
    // The vehicle at the front in the direction of travel: the loco, or the last wagon when pushing.
    const lead = d.dir > 0 ? this.cars[0] : this.cars[this.cars.length - 1];
    const fwd = new THREE.Vector3(0, 0, d.dir).applyQuaternion(lead.group.quaternion);
    this.followSun(orbit ? this.controls.target : lead.group.position);

    if (orbit) {
      if (changed) {
        const { center, radius } = this.bounds;
        const [h, back] = cam === "editor" ? [1.25, 0.7] : [0.8, 1.05];
        this.camera.position.set(center.x, radius * h + 20, center.z + radius * back + 20);
        this.controls.target.copy(center);
      }
      this.controls.update();
      return;
    }
    if (cam === "cab") {
      // Driver's seat on the right, looking along the track ahead.
      const seat = d.dir > 0 ? new THREE.Vector3(-0.6, 3.0, -1.4) : new THREE.Vector3(0.6, 3.5, -lead.length / 2 + 0.4);
      this.camera.position.copy(lead.group.localToWorld(seat));
      const ahead = this.path.pointAt(d.mid + d.dir * (this.trainLength / 2 + 22));
      ahead.y += RAIL_TOP + 1.6;
      if (changed) this.lookAt.copy(ahead);
      this.lookAt.lerp(ahead, 1 - Math.exp(-6 * dt));
      this.camera.lookAt(this.lookAt);
      return;
    }
    // Follow: behind and above the leading vehicle, smoothed.
    const want = lead.group.position.clone().addScaledVector(fwd, -16).add(new THREE.Vector3(0, 7, 0));
    if (changed) this.camera.position.copy(want);
    this.camera.position.lerp(want, 1 - Math.exp(-3 * dt));
    this.camera.lookAt(lead.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
  }

  private followSun(focus: THREE.Vector3) {
    this.sun.target.position.set(Math.round(focus.x / 10) * 10, 0, Math.round(focus.z / 10) * 10);
    this.sun.position.copy(this.sun.target.position).add(SUN_OFFSET);
  }

  // --- Editor ------------------------------------------------------------------------------

  private updateHandles(st: State) {
    const show = st.mode === "editor";
    this.handles.visible = show;
    this.conflicts.visible = show;
    if (!show || (this.handleRefs.track === st.track && this.handleRefs.selected === st.selected)) return;
    this.handleRefs = { track: st.track, selected: st.selected };
    this.handles.clear();
    const ball = new THREE.SphereGeometry(1.1, 20, 14);
    const big = new THREE.SphereGeometry(1.6, 20, 14);
    const stations = new Set(st.track.stations.map((s) => s.point));
    // Larger tracks are seen from further away; keep the points easy to grab.
    const k = Math.max(1, this.bounds.radius / 60);
    st.track.points.forEach(([x, y, z], i) => {
      const sel = i === st.selected;
      const station = stations.has(i);
      const color = sel ? 0xe37400 : station ? 0x188038 : 0x0b57d0;
      const m = new THREE.Mesh(station ? big : ball, new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.4) }));
      m.position.set(x, y + 1.6 * k, z);
      m.scale.setScalar(k);
      m.userData.index = i;
      this.handles.add(m);
      if (y > 0.05) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * k, 0.08 * k, y + 1.6 * k), new THREE.MeshBasicMaterial({ color }));
        stem.position.set(x, (y + 1.6 * k) / 2, z);
        this.handles.add(stem);
      }
    });
  }

  private ray(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(v, this.camera);
    return rc;
  }

  private onDown = (e: PointerEvent) => {
    if (useStore.getState().mode !== "editor") return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const hit = this.ray(e).intersectObjects(this.handles.children.filter((c) => c.userData.index !== undefined))[0];
    if (!hit) return;
    e.stopImmediatePropagation();
    this.dragging = hit.object.userData.index as number;
    select(this.dragging);
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragging === null) return;
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = this.ray(e).ray.intersectPlane(ground, new THREE.Vector3());
    if (p) dragPoint(this.dragging, THREE.MathUtils.clamp(p.x, -250, 250), THREE.MathUtils.clamp(p.z, -250, 250));
  };

  private onUp = (e: PointerEvent) => {
    const wasDragging = this.dragging !== null;
    this.dragging = null;
    // A click (not a drag of the view) on empty ground clears the selection.
    if (!wasDragging && this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 4 && e.target === this.renderer.domElement) {
      select(null);
    }
    this.downAt = null;
  };
}
