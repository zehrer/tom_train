/**
 * Saving tracks outside the app: one self-contained HTML file that shows the track as a map in any
 * browser. The track is embedded as JSON, so the file opens in tom_train again (button
 * "Open in tom_train", or File → Import).
 */
import { parseTrack, TrackGraph, type Switches, type Track } from "./track";

export const DATA_ID = "tom-train-data";
export const FORMAT = "tom_train";
export const VERSION = 1;

export interface TrackFile {
  name: string;
  track: Track;
  switches: Switches;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
/** "</" inside an embedded script would end the script element early. */
const scriptSafe = (s: string) => s.replace(/<\//g, "<\\/");

export function toJSON(file: TrackFile) {
  return JSON.stringify({ format: FORMAT, version: VERSION, name: file.name, track: file.track, switches: file.switches });
}

function parseSwitches(v: unknown): Switches {
  const out: Switches = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) if ((val === 0 || val === 1) && Number.isInteger(Number(k))) out[Number(k)] = val;
  return out;
}

/** The embedded JSON of an exported HTML file, or null if `html` is not one. */
export function extractJSON(html: string): string | null {
  const m = html.match(new RegExp(`<script[^>]*id="${DATA_ID}"[^>]*>([\\s\\S]*?)</script>`));
  return m ? m[1].replace(/<\\\//g, "</") : null;
}

/** Reads an exported HTML file or a JSON file; throws with a readable message if it is neither. */
export function parseFile(text: string, fallbackName = "Imported track"): TrackFile {
  const json = /^\s*</.test(text) ? extractJSON(text) : text;
  if (json === null) throw new Error("This HTML file was not exported from tom_train.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("The file is damaged (no valid track data).");
  }
  // A plain track (as saved in the browser) is accepted too.
  const track = parseTrack(data.track ?? data);
  if (!track) throw new Error("The file contains no valid track.");
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
  return { name, track, switches: parseSwitches(data.switches) };
}

/** A file name from the track name. */
export function fileName(name: string, ext: string) {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "track";
  return `${base}.${ext}`;
}

/** The track as a map seen from above. */
export function mapSVG(track: Track, switches: Switches = {}): string {
  const g = new TrackGraph(track);
  const pts = g.samples(2).map((s) => s.p);
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minZ = Math.min(...pts.map((p) => p.z)), maxZ = Math.max(...pts.map((p) => p.z));
  const pad = 30;
  const w = Math.max(80, maxX - minX) + 2 * pad, h = Math.max(60, maxZ - minZ) + 2 * pad;
  const ox = minX - pad - (Math.max(80, maxX - minX) - (maxX - minX)) / 2;
  const oz = minZ - pad - (Math.max(60, maxZ - minZ) - (maxZ - minZ)) / 2;
  const X = (x: number) => (x - ox).toFixed(1);
  const Z = (z: number) => (z - oz).toFixed(1);

  const lines = g.edges.map((e) => {
    const n = Math.max(2, Math.round(e.length / 2));
    const d = Array.from({ length: n + 1 }, (_, i) => {
      const p = g.pointOn(e.index, (i / n) * e.length);
      return `${i ? "L" : "M"}${X(p.x)} ${Z(p.z)}`;
    }).join("");
    const raised = g.pointOn(e.index, e.length / 2).y > 1.5;
    return { d, raised };
  });
  // Ballast, then sleepers (dashes), then rails on top; bridges a little darker.
  const track3 = lines.map(({ d, raised }) =>
    `<path d="${d}" class="bed${raised ? " bridge" : ""}"/><path d="${d}" class="sleepers"/><path d="${d}" class="rail"/>`).join("");

  const marks: string[] = [];
  for (const n of g.nodes.values()) {
    if (n.branches) {
      const e = g.edges[n.branches[switches[n.id] ?? 0]];
      const atA = e.a === n.id;
      const len = Math.min(10, e.length * 0.6);
      const k = 6;
      const d = Array.from({ length: k + 1 }, (_, i) => {
        const p = g.pointOn(e.index, atA ? (len * i) / k : e.length - (len * i) / k);
        return `${i ? "L" : "M"}${X(p.x)} ${Z(p.z)}`;
      }).join("");
      marks.push(`<path d="${d}" class="route"/><circle cx="${X(n.p.x)}" cy="${Z(n.p.z)}" r="2.2" class="switch"/>`);
    } else if (n.edges.length === 1) {
      const e = g.edges[n.edges[0]];
      const t = g.tangentOn(e.index, e.a === n.id ? 0 : e.length);
      const sx = -t.z * 2, sz = t.x * 2;
      marks.push(`<line x1="${X(n.p.x - sx)}" y1="${Z(n.p.z - sz)}" x2="${X(n.p.x + sx)}" y2="${Z(n.p.z + sz)}" class="buffer"/>`);
    }
  }
  const towns = track.stations
    .map((st) => {
      const n = g.nodes.get(st.node);
      if (!n) return "";
      return `<g class="town"><circle cx="${X(n.p.x)}" cy="${Z(n.p.z)}" r="3.4"/><text x="${X(n.p.x)}" y="${(Number(Z(n.p.z)) - 7).toFixed(1)}">${esc(st.name)}</text></g>`;
    })
    .join("");

  return `<svg class="map" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Track map">
<rect width="100%" height="100%" class="ground"/>${track3}${marks.join("")}${towns}</svg>`;
}

/** One self-contained HTML file: map, facts, and a button to open the track in the app. */
export function toHTML(file: TrackFile, appUrl: string): string {
  const g = new TrackGraph(file.track);
  const switchCount = [...g.nodes.values()].filter((n) => n.branches).length;
  const metres = Math.round(g.length / 0.6);
  const title = file.name || "Untitled track";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="tom_train">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f1f1f; background: #e8eaed; }
  body { margin: 0; padding: 0 16px 48px; }
  .topbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 1000px; margin: 0 auto; padding: 12px 0; background: #e8eaed; }
  .topbar h1 { flex: 1; min-width: 160px; margin: 0; font-size: 18px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .topbar button { border: 0; border-radius: 18px; padding: 9px 18px; font: inherit; font-weight: 500; cursor: pointer; background: #0b57d0; color: #fff; }
  .facts { max-width: 1000px; margin: 0 auto 12px; color: #444746; }
  .open { max-width: 1000px; margin: 0 auto 16px; padding: 10px 14px; border-radius: 12px; background: #fff; color: #444746; font-size: 13px; }
  .open a { color: #0b57d0; }
  .map { display: block; width: 100%; max-width: 1000px; height: auto; margin: 0 auto; border-radius: 16px; box-shadow: 0 1px 3px rgb(60 64 67 / 30%), 0 4px 12px rgb(60 64 67 / 12%); }
  .ground { fill: #a9cf83; }
  .bed { fill: none; stroke: #9a9184; stroke-width: 4.2; stroke-linecap: round; stroke-linejoin: round; }
  .bed.bridge { stroke: #7d756a; stroke-width: 4.8; }
  .sleepers { fill: none; stroke: #5b4636; stroke-width: 2.6; stroke-dasharray: 0.35 0.45; }
  .rail { fill: none; stroke: #e8eaed; stroke-width: 0.5; stroke-linecap: round; }
  .route { fill: none; stroke: #fbbc04; stroke-width: 1.4; stroke-linecap: round; }
  .switch { fill: #9334e6; stroke: #fff; stroke-width: 0.6; }
  .buffer { stroke: #c5221f; stroke-width: 1.6; stroke-linecap: round; }
  .town circle { fill: #188038; stroke: #fff; stroke-width: 0.8; }
  .town text { font: 600 6.5px -apple-system, "Segoe UI", Roboto, Arial, sans-serif; fill: #1f1f1f; text-anchor: middle; paint-order: stroke; stroke: #fff; stroke-width: 2px; stroke-linejoin: round; }
  @media print { body { background: #fff; } .topbar button, .open { display: none; } .map { box-shadow: none; } }
</style>
</head>
<body>
<div class="topbar">
  <h1>${esc(title)}</h1>
  <button id="open-in-app" type="button">Open in tom_train</button>
</div>
<p class="facts">${esc(`${file.track.stations.length} towns · ${switchCount} switches · ${metres} m of track`)}${
    file.track.stations.length ? ` · ${esc(file.track.stations.map((s) => s.name).join(", "))}` : ""
  }</p>
<p class="open">A copy of a railway made with <a href="${esc(appUrl)}">tom_train</a>, a free 3D railway app that runs in your browser. “Open in tom_train” adds this track to your library there and lets you drive it; if the button does not work, open the app and use <b>File → Import</b> with this file.</p>
${mapSVG(file.track, file.switches)}
<script type="application/json" id="${DATA_ID}">${scriptSafe(toJSON(file))}</script>
<script>
  var APP = ${scriptSafe(JSON.stringify(appUrl))};
  document.getElementById("open-in-app").onclick = function () {
    var win = window.open(APP + "#import", "_blank");
    if (!win) { alert("Please allow pop-ups, or open tom_train and use File \\u2192 Import with this file."); return; }
    var data = { type: "tom-train-data", json: document.getElementById("${DATA_ID}").textContent };
    window.addEventListener("message", function ready(e) {
      if (e.source !== win || !e.data || e.data.type !== "tom-train-ready") return;
      win.postMessage(data, new URL(APP).origin);
      window.removeEventListener("message", ready);
    });
  };
</script>
</body>
</html>
`;
}
