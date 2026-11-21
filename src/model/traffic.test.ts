import { describe, expect, it } from "vitest";
import { preset, TrackGraph, type Track } from "./track";
import { Traffic } from "./traffic";
import type { Driver } from "./drive";

const opts = { maxKmh: 120, accel: 14 };

function fleet(track: Track, lengths: number[]) {
  const t = new Traffic(new TrackGraph(track), track, {});
  lengths.forEach((L, i) => expect(t.add(i + 1, L, opts)).toBe(true));
  return t;
}

const pts = (d: Driver) => Array.from({ length: Math.floor(d.trainLength / 2) + 1 }, (_, k) => d.pointBehind(k * 2));

function closest(t: Traffic) {
  let min = Infinity;
  const all = t.trains.map((x) => pts(x.driver));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (const p of all[i]) for (const q of all[j]) min = Math.min(min, p.distanceTo(q));
  return min;
}

/** Runs the traffic; returns the closest two trains came and the stops each train made. */
function simulate(t: Traffic, seconds: number, cruise = 80) {
  let min = Infinity;
  const stops = new Map<number, number>(t.trains.map((x) => [x.id, 0]));
  const was = new Map<number, boolean>();
  for (let s = 0; s < seconds; s += 1 / 30) {
    const { turned } = t.update(1 / 30, cruise);
    void turned;
    min = Math.min(min, closest(t));
    for (const x of t.trains) {
      const standing = x.driver.dwell > 0;
      if (standing && !was.get(x.id)) stops.set(x.id, stops.get(x.id)! + 1);
      was.set(x.id, standing);
    }
  }
  return { min, stops: [...stops.values()] };
}

describe("Traffic", () => {
  it("places trains apart, at different stations first", () => {
    const t = fleet(preset("line"), [30, 30, 30]);
    expect(closest(t)).toBeGreaterThan(6);
  });

  it("refuses a train when there is no room left", () => {
    const track = preset("line");
    const t = new Traffic(new TrackGraph(track), track, {});
    let n = 0;
    while (n < 40 && t.add(n + 1, 40, opts)) n++;
    expect(n).toBeGreaterThan(2.4);
    expect(n).toBeLessThan(40);
  });

  it("two trains on one line never collide and keep running", () => {
    const { min, stops } = simulate(fleet(preset("line"), [30, 30]), 400);
    expect(min).toBeGreaterThan(2.4);
    for (const s of stops) expect(s).toBeGreaterThan(3);
  });

  it("several trains share the network with switches", () => {
    const { min, stops } = simulate(fleet(preset("network"), [30, 24, 36, 20, 30]), 500, 100);
    expect(min).toBeGreaterThan(2.4);
    for (const s of stops) expect(s).toBeGreaterThan(2.4);
  });

  it("trains on a loop follow each other without running into the one ahead", () => {
    const { min, stops } = simulate(fleet(preset("oval"), [30, 30, 30, 30]), 300, 120);
    expect(min).toBeGreaterThan(2.4);
    for (const s of stops) expect(s).toBeGreaterThan(2.4);
  });
});
