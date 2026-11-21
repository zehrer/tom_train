import { fileName, parseFile, toHTML } from "../model/files";
import { importTrack, isDirty, newFromPreset, saveTrack, saveTrackAs, useStore } from "../model/store";
import { PRESETS, type PresetId } from "../model/track";

const state = () => useStore.getState();
const LIVE_URL = "https://zehrer.github.io/tom_train/";
/** Exports point to the app they came from, but never to a local test server that may not be running. */
const appUrl = () => (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? LIVE_URL : location.origin + location.pathname);

function report(f: () => void) {
  try {
    f();
  } catch (e) {
    alert((e as Error).message);
  }
}

/** Hands a file to the browser to save (on iPad: the share sheet / Files app). */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const unsavedOk = (what: string) => !isDirty(state()) || confirm(`The track "${state().name}" has unsaved changes. ${what} anyway?`);

export function newTrack(id: PresetId) {
  const p = PRESETS.find((x) => x.id === id)!;
  if (unsavedOk(`Start a new track from "${p.name}"`)) newFromPreset(id);
}

export const save = () => report(saveTrack);

export function saveAs() {
  const name = prompt("Save the track as:", state().name);
  if (name !== null) report(() => saveTrackAs(name));
}

export function showOpen() {
  useStore.setState({ dialog: "open" });
}

/** One HTML file: a map of the track that any browser shows, with the track inside for re-import. */
export function exportHTML() {
  const s = state();
  download(fileName(s.name, "html"), toHTML({ name: s.name, track: s.track, switches: s.switches }, appUrl()), "text/html");
}

/** Lets the user pick exported HTML (or JSON) files; each becomes a library entry, the last one opens. */
export function importFromPicker() {
  if (!unsavedOk("Open an imported track")) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,.json,text/html,application/json";
  input.multiple = true;
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) {
      try {
        importTrack(parseFile(await f.text(), f.name.replace(/\.[^.]+$/, "")));
      } catch (e) {
        alert(`Could not import "${f.name}": ${(e as Error).message}`);
      }
    }
  };
  input.click();
}

/**
 * "Open in tom_train" in an exported file opens the app with #import and posts the track once the
 * app says it is ready. Only the page that opened us is listened to, and its data is validated.
 */
export function acceptHandover() {
  if (location.hash !== "#import" || !window.opener) return;
  history.replaceState(null, "", location.pathname + location.search);
  const opener = window.opener as Window;
  const onMessage = (e: MessageEvent) => {
    if (e.source !== opener || e.data?.type !== "tom-train-data" || typeof e.data.json !== "string") return;
    window.removeEventListener("message", onMessage);
    report(() => importTrack(parseFile(e.data.json)));
  };
  window.addEventListener("message", onMessage);
  opener.postMessage({ type: "tom-train-ready" }, "*");
}
