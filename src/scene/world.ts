import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clearSelection, dragNode, dropTrains, pickEdge, pickNode, selectTrain, toggleSwitch, useStore, type State, type TrainSpec } from "../model/store";
import { Traffic } from "../model/traffic";
import { trainType, type TrainType } from "../model/trains";
import { poseBetween, TrackGraph, type Switches, type Track } from "../model/track";
import { Scenery } from "./scenery";
import { buildSwitches, buildTrack, RAIL_TOP, Signal } from "./trackMesh";
import { buildTrain, CAR_GAP, disposeCar, Smoke, type TrainModel } from "./train";

/** One train on screen. */
interface TrainView {
  id: number;
  type: TrainType;
  wagons: number;
  model: TrainModel;
  group: THREE.Group;
  smoke: Smoke | null;
  distance: number;
}

const SUN_OFFSET = new THREE.Vector3(50, 90, 35);
/** Fingers are less precise than a mouse: bigger targets, more slack for a tap. */
const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Owns the three.js scene; reads the store every frame and reports live values back. */
export class World {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private last = performance.now();
  private frame = 0;
  private resize: ResizeObserver;
  private ground: THREE.Mesh;

  private trackRef: Track | null = null;
  private graph!: TrackGraph;
  private trackMesh: ReturnType<typeof buildTrack> | null = null;
  private switchRefs: { track: Track | null; switches: Switches | null } = { track: null, switches: null };
  private switchMesh: ReturnType<typeof buildSwitches> | null = null;
  private bounds = { center: new THREE.Vector3(), radius: 60 };
  private conflicts = new THREE.Group();
  private handles = new THREE.Group();
  private handleRefs: { track: Track | null; selected: State["selected"]; connectFrom: number | null } = { track: null, selected: null, connectFrom: null };
  private signals: { signal: Signal; station: number; edge: number; fwd: boolean; at: number }[] = [];

  private scenery = new Scenery();

  private trainGroup = new THREE.Group();
  private traffic: Traffic | null = null;
  private views = new Map<number, TrainView>();
  private trainsRef: TrainSpec[] | null = null;
  private signalLength = -1;
  private lastLive = 0;

  private lastCam: string | null = null;
  private camTrain = -1;
  private lookAt = new THREE.Vector3();
  private dragging: number | null = null;
  private down: { x: number; y: number; id: number } | null = null;
  private pointers = new Set<number>();

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0xcfe5fb);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 320, 700);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x6f8f4e, 1.6));
    // The sun's shadow area follows what the camera looks at, so large layouts keep their shadows.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 260 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    // The ground moves along under the camera and reaches well past the fog, so it has no visible edge.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1600, 64), new THREE.MeshStandardMaterial({ color: 0x8dbb62, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    this.scene.add(this.scenery.group, this.trainGroup, this.conflicts, this.handles);

    // One finger turns the view, two fingers zoom and move it.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 400;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.zoomToCursor = true;

    const el = this.renderer.domElement;
    // Capture phase: a grabbed point must win over the orbit controls on the same canvas.
    el.addEventListener("pointerdown", this.onDown, { capture: true });
    el.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(host);
    this.onResize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    this.controls.dispose();
    this.scenery.dispose();
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
    if (trackChanged) this.setTrack(st.track);
    if (trackChanged || st.trains !== this.trainsRef) this.syncTrains(st, trackChanged);
    this.updateSwitches(st);
    this.updateHandles(st);
    this.updateTrains(st, dt);
    this.updateCamera(st, dt);
    this.ground.position.set(this.camera.position.x, -0.02, this.camera.position.z);
    this.scenery.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  };

  // --- Track and scenery -------------------------------------------------------------------

  private setTrack(track: Track) {
    this.trackRef = track;
    this.graph = new TrackGraph(track);
    if (this.trackMesh) {
      this.scene.remove(this.trackMesh.group);
      this.trackMesh.dispose();
    }
    this.trackMesh = buildTrack(this.graph, track);
    this.scene.add(this.trackMesh.group);

    const box = new THREE.Box3().setFromPoints(this.graph.samples(4).map(({ p }) => p));
    box.getCenter(this.bounds.center).setY(0);
    const size = box.getSize(new THREE.Vector3());
    this.bounds.radius = Math.max(40, Math.max(size.x, size.z) / 2);

    this.conflicts.clear();
    const ring = new THREE.TorusGeometry(2.2, 0.25, 8, 32);
    ring.rotateX(Math.PI / 2);
    const red = new THREE.MeshBasicMaterial({ color: 0xd93025 });
    for (const p of this.graph.conflicts()) {
      const m = new THREE.Mesh(ring, red);
      m.position.set(p.x, p.y + 1.2, p.z);
      this.conflicts.add(m);
    }
    this.scenery.setTrack(this.graph, track);
    this.traffic?.setTrack(this.graph, track);
  }

  private updateSwitches(st: State) {
    if (this.switchRefs.track === st.track && this.switchRefs.switches === st.switches) return;
    this.switchRefs = { track: st.track, switches: st.switches };
    if (this.switchMesh) {
      this.scene.remove(this.switchMesh.group);
      this.switchMesh.dispose();
    }
    this.switchMesh = buildSwitches(this.graph, st.switches);
    this.scene.add(this.switchMesh.group);
    this.traffic?.setSwitches(st.switches);
  }

  // --- Trains and signals ------------------------------------------------------------------

  private makeView(spec: TrainSpec): TrainView {
    const model = buildTrain(spec.type, spec.wagons, spec.id - 1);
    const group = new THREE.Group();
    group.userData.train = spec.id;
    for (const c of model.cars) {
      c.group.userData.train = spec.id;
      group.add(c.group);
    }
    const smoke = model.exhaust ? new Smoke(model.exhaust.color) : null;
    if (smoke) group.add(smoke.group);
    this.trainGroup.add(group);
    return { id: spec.id, type: spec.type, wagons: spec.wagons, model, group, smoke, distance: 0 };
  }

  private dropView(v: TrainView) {
    this.trainGroup.remove(v.group);
    v.model.cars.forEach(disposeCar);
    v.smoke?.dispose();
  }

  /** Brings the trains on screen and in the simulation in line with the store. */
  private syncTrains(st: State, trackChanged: boolean) {
    this.trainsRef = st.trains;
    this.traffic ??= new Traffic(this.graph, st.track, st.switches);
    const traffic = this.traffic;
    const keep = new Set(st.trains.map((t) => t.id));
    for (const [id, v] of this.views) {
      if (keep.has(id)) continue;
      this.dropView(v);
      this.views.delete(id);
      traffic.remove(id);
    }
    const failed: number[] = [];
    for (const spec of st.trains) {
      const old = this.views.get(spec.id);
      if (old && old.type === spec.type && old.wagons === spec.wagons) continue;
      const info = trainType(spec.type);
      const v = this.makeView(spec);
      const opts = { maxKmh: info.maxKmh, accel: info.accel };
      if (old) {
        v.distance = old.distance;
        this.dropView(old);
        traffic.change(spec.id, v.model.length, opts);
      } else if (!traffic.add(spec.id, v.model.length, opts)) {
        this.dropView(v);
        failed.push(spec.id);
        continue;
      }
      this.views.set(spec.id, v);
    }
    if (failed.length) dropTrains(failed);

    const longest = Math.max(0, ...[...this.views.values()].map((v) => v.model.length));
    if (trackChanged || longest !== this.signalLength) this.buildSignals(st, longest);
  }

  /** Exit signals beyond the head of a train standing at each station, on every track leaving it. */
  private buildSignals(st: State, trainLength: number) {
    this.signalLength = trainLength;
    for (const x of this.signals) {
      this.scene.remove(x.signal.group);
      x.signal.dispose();
    }
    this.signals = [];
    st.track.stations.forEach((station, si) => {
      const n = this.graph.nodes.get(station.node);
      if (!n) return;
      // At a terminus the train stands with its tail at the buffers, so its head is further out.
      const at = n.edges.length === 1 ? trainLength + 4.5 : trainLength / 2 + 3;
      for (const e of n.edges) {
        const edge = this.graph.edges[e];
        if (at > edge.length - 1) continue;
        const fwd = edge.a === n.id;
        const s = fwd ? at : edge.length - at;
        const travel = this.graph.tangentOn(e, s);
        if (!fwd) travel.negate();
        const signal = new Signal(this.graph.pointOn(e, s), travel);
        this.scene.add(signal.group);
        this.signals.push({ signal, station: si, edge: e, fwd, at });
      }
    });
  }

  private updateTrains(st: State, dt: number) {
    const traffic = this.traffic!;
    const cruise = st.mode === "simulator" && st.running ? st.speed : 0;
    const { moved, turned } = traffic.update(dt, cruise);
    for (const node of turned) toggleSwitch(node);

    for (const t of traffic.trains) {
      const v = this.views.get(t.id);
      if (!v) continue;
      const d = t.driver;
      const ds = moved.get(t.id) ?? 0;
      v.distance += ds;
      const cars = v.model.cars;
      // Vehicles from the head backwards; when pushing, the loco is at the tail and all face backwards.
      const order = d.flipped ? [...cars].reverse() : cars;
      let dist = 0;
      order.forEach((car, k) => {
        dist += k === 0 ? car.length / 2 : order[k - 1].length / 2 + CAR_GAP + car.length / 2;
        const front = d.pointBehind(dist - car.half), back = d.pointBehind(dist + car.half);
        if (d.flipped) poseBetween(back, front, car.group.position, car.group.quaternion);
        else poseBetween(front, back, car.group.position, car.group.quaternion);
        car.group.position.y += RAIL_TOP;
        for (const w of car.wheels) w.mesh.rotation.x += ((d.flipped ? -1 : 1) * ds) / w.radius;
      });
      if (v.smoke && v.model.exhaust) {
        const ex = v.model.exhaust;
        v.smoke.update(dt, cars[0].group.localToWorld(ex.at.clone()), ex.rate(d.kmh));
      }
    }

    // An exit signal is green from shortly before departure until the head has passed it, if the line is free.
    for (const x of this.signals) {
      x.signal.set(
        traffic.trains.some(({ driver: d, limit }) => {
          const head = d.head;
          return d.at?.station === x.station && d.clear && head.edge === x.edge && head.fwd === x.fwd && d.h < x.at && limit > 10;
        }),
      );
    }

    const now = performance.now();
    if (now - this.lastLive > 150) {
      this.lastLive = now;
      const t = traffic.get(st.active) ?? traffic.trains[0];
      const v = t && this.views.get(t.id);
      if (!t || !v) return;
      const d = t.driver;
      const next = d.dwell > 0 ? null : d.next()?.stop;
      const sw = d.nextSwitch();
      useStore.setState({
        live: {
          kmh: Math.round(d.kmh),
          distance: v.distance / (0.6 * 1000),
          at: d.dwell > 0 && d.at ? (d.at.name ?? "End of the line") : null,
          next: next ? (next.name ?? "End of the line") : null,
          nextSwitch: sw ? { node: sw.node, diverging: st.switches[sw.node] === 1 } : null,
          waiting: cruise > 0 && d.dwell <= 0 && t.limit < 1 && d.kmh < 1,
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

    const t = this.traffic?.get(st.active) ?? this.traffic?.trains[0];
    const v = t && this.views.get(t.id);
    if (!t || !v) {
      this.controls.update();
      return;
    }
    const d = t.driver;
    // The vehicle at the head: the loco, or the last car when pushing.
    const cars = v.model.cars;
    const lead = d.flipped ? cars[cars.length - 1] : cars[0];
    const switched = v.id !== this.camTrain;
    this.camTrain = v.id;
    const headP = d.pointBehind(0);
    const fwd = headP.clone().sub(d.pointBehind(4)).setY(0).normalize();
    this.followSun(orbit ? this.controls.target : lead.group.position);

    if (orbit) {
      if (changed) {
        const { center, radius } = this.bounds;
        const [h, back] = cam === "editor" ? [1.25, 0.7] : [0.8, 1.05];
        // Upright screens see less to the sides: step back so the whole layout fits.
        const r = radius / Math.min(1, this.camera.aspect * 0.8);
        this.camera.position.set(center.x, r * h + 20, center.z + r * back + 20);
        this.controls.target.copy(center);
      }
      this.controls.update();
      return;
    }
    if (cam === "cab") {
      // Driver's seat on the right, looking along the track ahead.
      const seat = ((d.flipped ? lead.cab?.back : lead.cab?.front) ?? new THREE.Vector3(0, 3.5, 0)).clone();
      this.camera.position.copy(lead.group.localToWorld(seat));
      const ahead = d.pointAhead(22);
      ahead.y += RAIL_TOP + 1.6;
      if (changed || switched) this.lookAt.copy(ahead);
      this.lookAt.lerp(ahead, 1 - Math.exp(-6 * dt));
      this.camera.lookAt(this.lookAt);
      return;
    }
    // Follow: behind and above the head of the train, smoothed.
    const want = lead.group.position.clone().addScaledVector(fwd, -16).add(new THREE.Vector3(0, 7, 0));
    if (changed || switched) this.camera.position.copy(want);
    this.camera.position.lerp(want, 1 - Math.exp(-3 * dt));
    this.camera.lookAt(lead.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
  }

  private followSun(focus: THREE.Vector3) {
    this.sun.target.position.set(Math.round(focus.x / 10) * 10, 0, Math.round(focus.z / 10) * 10);
    this.sun.position.copy(this.sun.target.position).add(SUN_OFFSET);
  }

  // --- Editor ------------------------------------------------------------------------------

  /** Point handles grow with the layout and on touch screens, so they stay easy to grab. */
  private handleScale() {
    return Math.max(1, this.bounds.radius / 60) * (coarse() ? 1.5 : 1);
  }

  private updateHandles(st: State) {
    const show = st.mode === "editor";
    this.handles.visible = show;
    this.conflicts.visible = show;
    const refs = this.handleRefs;
    if (!show || (refs.track === st.track && refs.selected === st.selected && refs.connectFrom === st.connectFrom)) return;
    this.handleRefs = { track: st.track, selected: st.selected, connectFrom: st.connectFrom };
    this.handles.clear();
    const k = this.handleScale();
    const ball = new THREE.SphereGeometry(1.1, 20, 14);
    const big = new THREE.SphereGeometry(1.6, 20, 14);
    const stations = new Set(st.track.stations.map((s) => s.node));
    const sel = st.selected;
    for (const n of this.graph.nodes.values()) {
      const selected = sel?.kind === "node" && sel.id === n.id;
      const station = stations.has(n.id);
      const color =
        st.connectFrom === n.id ? 0xd93025 : selected ? 0xe37400 : station ? 0x188038 : n.branches ? 0x9334e6 : 0x0b57d0;
      const m = new THREE.Mesh(station ? big : ball, new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.4) }));
      m.position.set(n.p.x, n.p.y + 1.6 * k, n.p.z);
      m.scale.setScalar(k);
      m.userData.node = n.id;
      this.handles.add(m);
      if (n.p.y > 0.05) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * k, 0.08 * k, n.p.y + 1.6 * k), new THREE.MeshBasicMaterial({ color }));
        stem.position.set(n.p.x, (n.p.y + 1.6 * k) / 2, n.p.z);
        this.handles.add(stem);
      }
    }
    if (sel?.kind === "edge" && this.graph.edges[sel.index]) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(this.graph.edges[sel.index].curve, 48, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xe37400 }));
      tube.position.y = 0.7;
      this.handles.add(tube);
    }
  }

  private raycaster(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(v, this.camera);
    return rc;
  }

  private onDown = (e: PointerEvent) => {
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1) {
      // A second finger: this is a zoom or pan gesture, not a tap or a drag.
      this.down = null;
      if (this.dragging !== null) this.dragging = null;
      return;
    }
    this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (useStore.getState().mode !== "editor") return;
    const hit = this.raycaster(e).intersectObjects(this.handles.children.filter((c) => c.userData.node !== undefined))[0];
    if (!hit) return;
    e.stopImmediatePropagation();
    this.dragging = hit.object.userData.node as number;
    pickNode(this.dragging);
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragging === null || e.pointerId !== this.down?.id) return;
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = this.raycaster(e).ray.intersectPlane(ground, new THREE.Vector3());
    if (p) dragNode(this.dragging, THREE.MathUtils.clamp(p.x, -250, 250), THREE.MathUtils.clamp(p.z, -250, 250));
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.dragging = null;
    this.down = null;
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const wasDragging = this.dragging !== null;
    this.dragging = null;
    const down = this.down;
    this.down = null;
    if (wasDragging || !down || down.id !== e.pointerId || e.target !== this.renderer.domElement) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > (e.pointerType === "touch" ? 10 : 4)) return;
    this.tap(e);
  };

  /** A tap or click that wasn't a drag: turn a switch, or pick a piece of track. */
  private tap(e: PointerEvent) {
    const rc = this.raycaster(e);
    const lever = this.switchMesh && rc.intersectObjects(this.switchMesh.levers, true)[0];
    if (lever) {
      toggleSwitch(lever.object.userData.switchNode as number);
      return;
    }
    // A tap on a train makes it the one the cameras and controls follow.
    const car = rc.intersectObjects(this.trainGroup.children, true)[0];
    if (car) {
      let o: THREE.Object3D | null = car.object;
      while (o && o.userData.train === undefined) o = o.parent;
      if (o) {
        selectTrain(o.userData.train as number);
        return;
      }
    }
    if (useStore.getState().mode !== "editor" || !this.trackMesh) return;
    const bed = rc.intersectObjects(this.trackMesh.beds)[0];
    if (bed) pickEdge(bed.object.userData.edge as number);
    else clearSelection();
  }
}
