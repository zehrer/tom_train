import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { insertAfter, MIN_POINTS, movePoint, parseTrack, preset, PRESETS, raisePoint, removePoint, setClosed, toggleStation, TrackPath } from "./track";

describe("presets", () => {
  for (const { id } of PRESETS) {
    it(`${id} is a valid track without conflicts`, () => {
      const track = preset(id);
      expect(parseTrack(JSON.parse(JSON.stringify(track)))).toEqual(track);
      const path = new TrackPath(track);
      expect(path.length).toBeGreaterThan(150);
      if (track.closed) expect(path.pointAt(0).distanceTo(path.pointAt(path.length))).toBeLessThan(1e-6);
      expect(track.stations.length).toBeGreaterThan(0);
      for (const { p } of path.samples(1)) expect(p.y).toBeGreaterThan(-0.3);
      expect(path.conflicts()).toEqual([]);
    });
  }

  it("the figure eight crosses itself on two levels", () => {
    const path = new TrackPath(preset("eight"));
    const atCenter = path.samples(0.5).filter(({ p }) => Math.hypot(p.x, p.z) < 1);
    const ys = atCenter.map(({ p }) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3.6);
  });
});

describe("TrackPath", () => {
  it("wraps positions around the loop", () => {
    const path = new TrackPath(preset("oval"));
    expect(path.pointAt(-10).distanceTo(path.pointAt(path.length - 10))).toBeLessThan(1e-6);
  });

  it("places a vehicle between its bogies, facing forward", () => {
    const path = new TrackPath(preset("oval"));
    const { position, quaternion } = path.vehiclePose(0, 2);
    // The oval starts on a straight running in +x.
    expect(position.x).toBeCloseTo(0, 1);
    const forward = new Vector3(0, 0, 1).applyQuaternion(quaternion);
    expect(forward.x).toBeCloseTo(1, 2);
  });

  it("finds a crossing at the same height", () => {
    const flat = preset("eight");
    flat.points = flat.points.map(([x, , z]) => [x, 0, z]);
    expect(new TrackPath(flat).conflicts().length).toBeGreaterThan(0);
  });
});

describe("editing", () => {
  it("inserts, moves, raises and removes points", () => {
    let t = preset("oval");
    const n = t.points.length;
    t = insertAfter(t, 0);
    expect(t.points.length).toBe(n + 1);
    t = movePoint(t, 1, 5, 7);
    expect(t.points[1][0]).toBe(5);
    expect(t.points[1][2]).toBe(7);
    t = raisePoint(t, 1, 100);
    expect(t.points[1][1]).toBe(8);
    t = raisePoint(t, 1, -100);
    expect(t.points[1][1]).toBe(0);
    t = removePoint(t, 1);
    expect(t.points.length).toBe(n);
  });

  it("keeps at least the minimum number of points", () => {
    let t = { ...preset("oval"), points: preset("oval").points.slice(0, MIN_POINTS) };
    t = removePoint(t, 0);
    expect(t.points.length).toBe(MIN_POINTS);
  });
});

describe("lines and stations", () => {
  it("the line preset connects four towns in order", () => {
    const t = preset("line");
    const path = new TrackPath(t);
    expect(t.closed).toBe(false);
    const ss = t.stations.map((st) => path.pointS[st.point]);
    expect(ss).toEqual([...ss].sort((a, b) => a - b));
    expect(ss[0]).toBe(0);
    expect(ss[3]).toBeCloseTo(path.length, 0);
  });

  it("extends a line straight past its ends", () => {
    const path = new TrackPath(preset("line"));
    const end = path.pointAt(path.length);
    expect(path.pointAt(path.length + 10).distanceTo(end)).toBeCloseTo(10, 3);
  });

  it("keeps stations on their points when points are inserted or removed", () => {
    let t = preset("line");
    t = insertAfter(t, 1);
    expect(t.stations.map((s) => s.point)).toEqual([0, 6, 11, 15]);
    t = insertAfter(t, t.points.length - 1);
    expect(t.points.length).toBe(17);
    t = removePoint(t, 6);
    expect(t.stations.map((s) => s.name)).toEqual(["Lindenberg", "Eichstadt", "Rosenhain"]);
    expect(t.stations.map((s) => s.point)).toEqual([0, 10, 14]);
  });

  it("toggles stations with unused names", () => {
    let t = preset("line");
    t = toggleStation(t, 2);
    expect(t.stations.at(-1)).toEqual({ point: 2, name: "Birkenau" });
    t = toggleStation(t, 2);
    expect(t.stations.length).toBe(4);
  });

  it("switches between loop and line", () => {
    expect(setClosed(preset("line"), true).closed).toBe(true);
    expect(setClosed(preset("oval"), false).closed).toBe(false);
  });

  it("reads tracks saved before stations existed", () => {
    const t = parseTrack({ points: preset("oval").points });
    expect(t?.closed).toBe(true);
    expect(t?.stations).toEqual([{ point: 0, name: "Lindenberg" }]);
    expect(parseTrack({ points: [[0, 0, 0]] })).toBeNull();
  });
});
