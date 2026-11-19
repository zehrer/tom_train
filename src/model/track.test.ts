import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { connect, degree, extend, parseTrack, poseBetween, preset, PRESETS, raiseNode, removeEdge, removeNode, split, toggleStation, TrackGraph } from "./track";

describe("presets", () => {
  for (const { id } of PRESETS) {
    it(`${id} is a valid network without conflicts`, () => {
      const track = preset(id);
      expect(parseTrack(JSON.parse(JSON.stringify(track)))).toEqual(track);
      const g = new TrackGraph(track);
      expect(g.length).toBeGreaterThan(150);
      expect(track.stations.length).toBeGreaterThan(0);
      for (const { p } of g.samples(1)) expect(p.y).toBeGreaterThan(-0.3);
      expect(g.conflicts()).toEqual([]);
    });
  }

  it("the figure eight crosses itself on two levels", () => {
    const g = new TrackGraph(preset("eight"));
    const ys = g.samples(0.5).filter(({ p }) => Math.hypot(p.x, p.z) < 1).map(({ p }) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3.6);
  });

  it("the network has three switches with the main line straight", () => {
    const track = preset("network");
    const g = new TrackGraph(track);
    const switches = [...g.nodes.values()].filter((n) => n.trunk !== undefined).map((n) => n.id);
    expect(switches.sort((a, b) => a - b)).toEqual([4, 6, 11]);
    const edgeOf = (a: number, b: number) => track.edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    const sw = g.nodes.get(11)!;
    expect(sw.trunk).toBe(edgeOf(10, 11));
    expect(sw.branches).toEqual([edgeOf(11, 12), edgeOf(11, 200)]);
    expect(g.nodes.get(6)!.trunk).toBe(edgeOf(6, 7));
  });
});

describe("TrackGraph", () => {
  it("is smooth where edges meet", () => {
    const g = new TrackGraph(preset("network"));
    for (const n of g.nodes.values()) {
      const dirs = n.edges.map((e) => {
        const edge = g.edges[e];
        const t = g.tangentOn(e, edge.a === n.id ? 0 : edge.length);
        return t.setY(0).normalize();
      });
      // Every edge leaves the node along the same line.
      for (const d of dirs) expect(Math.abs(d.dot(dirs[0]))).toBeGreaterThan(0.999);
    }
  });

  it("lets trains through a switch only along the allowed ways", () => {
    const track = preset("network");
    const g = new TrackGraph(track);
    const sw = g.nodes.get(11)!;
    expect(g.exits(11, sw.trunk!)).toEqual(sw.branches);
    expect(g.exits(11, sw.branches![1])).toEqual([sw.trunk]);
    expect(g.exits(0, g.nodes.get(0)!.edges[0])).toEqual([]);
  });

  it("finds the nearest place on the network", () => {
    const g = new TrackGraph(preset("line"));
    const p = g.pointOn(3, 5);
    const n = g.nearest(p.clone().add(new Vector3(0.3, 0, 0.3)));
    expect(n.edge).toBe(3);
    expect(n.distance).toBeLessThan(0.5);
  });

  it("finds a crossing at the same height", () => {
    const flat = preset("eight");
    flat.nodes = flat.nodes.map((n) => ({ ...n, y: 0 }));
    expect(new TrackGraph(flat).conflicts().length).toBeGreaterThan(0);
  });

  it("orients a vehicle from its rear to its front bogie", () => {
    const { position, quaternion } = poseBetween(new Vector3(2, 0, 0), new Vector3(-2, 0, 0));
    expect(position.x).toBeCloseTo(0);
    expect(new Vector3(0, 0, 1).applyQuaternion(quaternion).x).toBeCloseTo(1);
  });
});

describe("editing", () => {
  it("extends a track end straight on", () => {
    const t = preset("line");
    const { track, node } = extend(t, 14);
    expect(node).not.toBeNull();
    const n = track.nodes.find((x) => x.id === node)!;
    expect(n.x).toBeGreaterThan(155);
    expect(degree(track, 14)).toBe(2);
  });

  it("branches from a plain point, which becomes a switch", () => {
    const { track, node } = extend(preset("line"), 7);
    expect(degree(track, 7)).toBe(3);
    const g = new TrackGraph(track);
    expect(g.nodes.get(7)!.branches).toContain(track.edges.length - 1);
    expect(extend(track, 7).node).toBeNull(); // a switch can't branch again
    expect(node).toBe(15);
  });

  it("splits an edge and removes a point, joining its neighbours again", () => {
    let t = preset("line");
    const s = split(t, 2);
    t = s.track;
    expect(t.edges.length).toBe(15);
    expect(degree(t, s.node)).toBe(2);
    t = removeNode(t, s.node);
    expect(t.edges.length).toBe(14);
    expect(t.edges.some(([a, b]) => (a === 2 && b === 3) || (a === 3 && b === 2))).toBe(true);
  });

  it("connects two track ends into a loop", () => {
    const t = connect(preset("line"), 0, 14);
    expect(t.edges.length).toBe(15);
    expect(connect(t, 0, 14)).toBe(t); // already joined
  });

  it("removes an edge and nodes left without track", () => {
    let t = preset("line");
    t = removeEdge(t, 13); // between 13 and 14
    expect(t.nodes.some((n) => n.id === 14)).toBe(false);
    expect(t.stations.map((s) => s.name)).not.toContain("Rosenhain");
  });

  it("keeps stations off switches", () => {
    let t = toggleStation(preset("line"), 7);
    expect(t.stations.some((s) => s.node === 7)).toBe(true);
    t = extend(t, 7).track;
    expect(t.stations.some((s) => s.node === 7)).toBe(false);
    expect(toggleStation(t, 7)).toBe(t);
  });

  it("raises within limits", () => {
    expect(raiseNode(preset("line"), 3, 100).nodes[3].y).toBe(8);
    expect(raiseNode(preset("line"), 3, -100).nodes[3].y).toBe(0);
  });

  it("reads tracks saved in the older loop/line format", () => {
    const t = parseTrack({ points: [[0, 0, 0], [40, 0, 0], [40, 0, 40], [0, 0, 40]], closed: true, stations: [{ point: 2, name: "X" }] });
    expect(t?.edges.length).toBe(4);
    expect(t?.stations).toEqual([{ node: 2, name: "X" }]);
    expect(parseTrack({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }], edges: [[1, 2]] })).toBeNull();
  });
});
