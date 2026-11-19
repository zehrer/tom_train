import { describe, expect, it } from "vitest";
import { DWELL, Driver } from "./drive";
import { insertAfter, movePoint, preset, TrackPath } from "./track";

function run(d: Driver, seconds: number, cruise = 60, log?: (d: Driver) => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    d.update(1 / 30, cruise);
    log?.(d);
  }
}

/** Names of the stops in the order the train stands at them. */
function visits(track = preset("line"), seconds = 400) {
  const path = new TrackPath(track);
  const d = new Driver(path, track, 30);
  const seen: string[] = [];
  let last: unknown = d.at;
  run(d, seconds, 60, (x) => {
    if (x.dwell > 0 && x.at !== last) seen.push(x.at!.name ?? "end");
    last = x.dwell > 0 ? x.at : null;
  });
  return { d, seen };
}

describe("Driver", () => {
  it("shuttles along a line, stopping at every town and reversing at the ends", () => {
    const { seen } = visits();
    expect(seen.slice(0, 6)).toEqual(["Mühlbach", "Eichstadt", "Rosenhain", "Eichstadt", "Mühlbach", "Lindenberg"]);
  });

  it("stands still with its middle at the station", () => {
    const track = preset("line");
    const path = new TrackPath(track);
    const d = new Driver(path, track, 30);
    run(d, 2);
    let stoppedAt: number | null = null;
    run(d, 120, 60, (x) => {
      if (stoppedAt === null && x.dwell > 0 && x.at?.name === "Mühlbach") stoppedAt = x.mid;
    });
    expect(stoppedAt).toBeCloseTo(path.pointS[5], 3);
  });

  it("never exceeds the cruise speed and keeps the train on the line", () => {
    const track = preset("line");
    const path = new TrackPath(track);
    const d = new Driver(path, track, 30);
    run(d, 300, 80, (x) => {
      expect(x.kmh).toBeLessThanOrEqual(80);
      expect(x.mid).toBeGreaterThanOrEqual(16.5 - 1e-6);
      expect(x.mid).toBeLessThanOrEqual(path.length - 16.5 + 1e-6);
    });
  });

  it("circles a loop and stops at its station every lap", () => {
    const { seen } = visits(preset("oval"), 200);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen)).toEqual(new Set(["Lindenberg"]));
  });

  it("waits at a station only while running", () => {
    const track = preset("line");
    const d = new Driver(new TrackPath(track), track, 30);
    run(d, 10, 0);
    expect(d.dwell).toBeGreaterThan(0);
    expect(d.dwell).toBeLessThanOrEqual(DWELL);
    expect(d.kmh).toBe(0);
  });

  it("stays in place when the track is edited", () => {
    let track = preset("line");
    let path = new TrackPath(track);
    const d = new Driver(path, track, 30);
    run(d, 12); // on its way between the first two towns
    expect(d.dwell).toBe(0);
    const before = path.pointAt(d.mid);
    // Lengthen the track before the train and add a point.
    track = insertAfter(movePoint(track, 0, -170, 30), 0);
    path = new TrackPath(track);
    d.setTrack(path, track, 30);
    expect(path.pointAt(d.mid).distanceTo(before)).toBeLessThan(0.1);
  });

  it("moves along with the station it stands at", () => {
    let track = preset("line");
    const d = new Driver(new TrackPath(track), track, 30);
    track = movePoint(track, 0, -150, 10);
    const path = new TrackPath(track);
    d.setTrack(path, track, 30);
    expect(d.dwell).toBeGreaterThan(0);
    expect(d.at?.name).toBe("Lindenberg");
    expect(d.mid).toBeCloseTo(d.at!.s, 6);
  });
});
