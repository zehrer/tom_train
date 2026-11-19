import { describe, expect, it } from "vitest";
import { DWELL, Driver } from "./drive";
import { moveNode, preset, split, TrackGraph, type Switches, type Track } from "./track";

const T = 30;

function make(track: Track, switches: Switches = {}) {
  return new Driver(new TrackGraph(track), track, T, switches);
}

function run(d: Driver, seconds: number, cruise = 60, each?: (d: Driver) => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    d.update(1 / 30, cruise);
    each?.(d);
  }
}

/** Names of the stops in the order the train stands at them. */
function visits(d: Driver, seconds: number) {
  const seen: string[] = [];
  let last: unknown = null;
  run(d, seconds, 80, (x) => {
    if (x.dwell > 0 && x.at && x.at !== last) seen.push(x.at.name ?? "end");
    last = x.dwell > 0 ? x.at : null;
  });
  return seen;
}

describe("Driver", () => {
  it("shuttles along a line, stopping at every town and reversing at the ends", () => {
    expect(visits(make(preset("line")), 400).slice(0, 6)).toEqual(["Mühlbach", "Eichstadt", "Rosenhain", "Eichstadt", "Mühlbach", "Lindenberg"]);
  });

  it("keeps the main line with all switches straight", () => {
    expect(visits(make(preset("network")), 300).slice(0, 4)).toEqual(["Mühlbach", "Eichstadt", "Rosenhain", "Eichstadt"]);
  });

  it("takes the branch to Birkenau when the switch is turned, and comes back", () => {
    expect(visits(make(preset("network"), { 11: 1 }), 300).slice(0, 4)).toEqual(["Mühlbach", "Eichstadt", "Birkenau", "Eichstadt"]);
  });

  it("runs through the passing loop and skips the station on the main line", () => {
    const seen = visits(make(preset("network"), { 4: 1 }), 120);
    expect(seen[0]).toBe("Eichstadt");
  });

  it("stands with its middle at the station", () => {
    const track = preset("line");
    const g = new TrackGraph(track);
    const d = new Driver(g, track, T, {});
    let mid: number | null = null;
    run(d, 120, 60, (x) => {
      if (mid === null && x.dwell > 0 && x.at?.name === "Mühlbach") mid = x.pointBehind(T / 2).distanceTo(g.nodes.get(5)!.p);
    });
    expect(mid).toBeLessThan(0.05);
  });

  it("never exceeds the cruise speed and stops short of the buffers", () => {
    const track = preset("line");
    const g = new TrackGraph(track);
    const d = new Driver(g, track, T, {});
    const end = g.nodes.get(14)!.p;
    run(d, 300, 80, (x) => {
      expect(x.kmh).toBeLessThanOrEqual(80);
      expect(x.pointBehind(0).distanceTo(end)).toBeGreaterThan(1);
    });
  });

  it("keeps the loco where it is when reversing", () => {
    const d = make(preset("line"));
    const loco = () => (d.flipped ? d.pointBehind(T - 3) : d.pointBehind(3));
    run(d, 300, 80, () => {});
    let before = loco();
    let flipped = d.flipped;
    run(d, 300, 80, (x) => {
      if (x.flipped !== flipped) {
        expect(loco().distanceTo(before)).toBeLessThan(0.5);
        flipped = x.flipped;
      }
      before = loco();
    });
  });

  it("circles a loop and stops at its station every lap", () => {
    const seen = visits(make(preset("oval")), 200);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen)).toEqual(new Set(["Lindenberg"]));
  });

  it("waits at a station only while running", () => {
    const d = make(preset("line"));
    run(d, 10, 0);
    expect(d.dwell).toBeGreaterThan(0);
    expect(d.dwell).toBeLessThanOrEqual(DWELL);
    expect(d.kmh).toBe(0);
  });

  it("stays in place when the track is edited", () => {
    let track = preset("line");
    const d = make(track);
    run(d, 8);
    expect(d.dwell).toBe(0);
    const head = d.pointBehind(0), tail = d.pointBehind(T);
    track = split(moveNode(track, 0, -170, 30), 0).track;
    d.setTrack(new TrackGraph(track), track, T);
    expect(d.pointBehind(0).distanceTo(head)).toBeLessThan(0.1);
    expect(d.pointBehind(T).distanceTo(tail)).toBeLessThan(1);
  });

  it("follows a switch turned while it runs", () => {
    const track = preset("network");
    const d = make(track);
    run(d, 3);
    expect(d.nextSwitch()?.node).toBe(4);
    d.setSwitches({ 4: 1, 11: 1 });
    const seen = visits(d, 300);
    expect(seen.slice(0, 2)).toEqual(["Eichstadt", "Birkenau"]);
  });
});
