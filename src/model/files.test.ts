import { describe, expect, it } from "vitest";
import { extractJSON, fileName, mapSVG, parseFile, toHTML, toJSON } from "./files";
import { uniqueName, type SavedTrack } from "./library";
import { preset } from "./track";

const file = { name: 'Tom\'s "Line" </script>', track: preset("network"), switches: { 11: 1 as const } };

describe("HTML export", () => {
  it("round-trips through the exported file", () => {
    const html = toHTML(file, "https://example.org/tom_train/");
    const back = parseFile(html);
    expect(back).toEqual(file);
  });

  it("keeps the page intact whatever the name contains", () => {
    const html = toHTML(file, "https://example.org/tom_train/");
    expect(html.match(/<\/script>/g)?.length).toBe(2);
    expect(html).toContain("<title>Tom's &quot;Line&quot; &lt;/script&gt;</title>");
    expect(extractJSON(html)).toBe(toJSON(file));
  });

  it("shows a map with every town, switch and buffer stop", () => {
    const svg = mapSVG(file.track, file.switches);
    for (const s of file.track.stations) expect(svg).toContain(`>${s.name}</text>`);
    expect(svg.match(/class="switch"/g)?.length).toBe(3);
    expect(svg.match(/class="buffer"/g)?.length).toBe(3);
  });
});

describe("import", () => {
  it("reads JSON files and plain tracks", () => {
    expect(parseFile(toJSON(file)).name).toBe(file.name);
    expect(parseFile(JSON.stringify(preset("oval")), "Fallback").name).toBe("Fallback");
  });

  it("explains what is wrong with other files", () => {
    expect(() => parseFile("<html><body>hello</body></html>")).toThrow(/not exported from tom_train/);
    expect(() => parseFile("{nope")).toThrow(/damaged/);
    expect(() => parseFile('{"track": {"nodes": []}}')).toThrow(/no valid track/);
  });

  it("drops invalid switch entries", () => {
    const f = parseFile(JSON.stringify({ track: preset("line"), switches: { 3: 1, x: 1, 4: 7 } }));
    expect(f.switches).toEqual({ 3: 1 });
  });
});

describe("names", () => {
  it("makes file names safe", () => {
    expect(fileName('a/b:c*"d"', "html")).toBe("a-b-c-d-.html");
    expect(fileName("   ", "html")).toBe("track.html");
  });

  it("numbers duplicate library names", () => {
    const list = [{ id: "1", name: "Line" }, { id: "2", name: "Line (2)" }] as SavedTrack[];
    expect(uniqueName(list, "Line")).toBe("Line (3)");
    expect(uniqueName(list, "Line", "1")).toBe("Line");
    expect(uniqueName(list, "Oval")).toBe("Oval");
  });
});
