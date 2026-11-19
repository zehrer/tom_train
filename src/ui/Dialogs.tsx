import { deleteSaved, isDirty, openSaved, useStore } from "../model/store";
import { importFromPicker } from "./files";
import { SHORTCUTS } from "./actions";
import { LIVE_URL, Logo, REPO_URL } from "./Header";

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        {dialog === "open" ? (
          <OpenList />
        ) : dialog === "keys" ? (
          <>
            <h2>Keyboard shortcuts</h2>
            <table>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys}>
                    <td><kbd>{s.keys}</kbd></td>
                    <td>{s.label}{s.mode && <span className="muted"> · {s.mode}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <div className="about-head"><Logo /><h2>tom_train</h2></div>
            <p>Build a railway network in 3D with towns, switches and signals, and ride along in the driver's cab. Everything runs in your browser; your track is saved there. Works with mouse, keyboard and touch (iPad).</p>
            <p>
              Live app: <a href={LIVE_URL} target="_blank" rel="noopener">{LIVE_URL.replace("https://", "")}</a>
              <br />
              Source: <a href={REPO_URL} target="_blank" rel="noopener">{REPO_URL.replace("https://", "")}</a>
            </p>
            <p className="muted">Version {__APP_VERSION__} · {__APP_BUILD__}</p>
          </>
        )}
        <div className="dialog-actions"><button onClick={close}>Close</button></div>
      </div>
    </div>
  );
}

function OpenList() {
  const library = useStore((s) => s.library);
  const current = useStore((s) => s.libraryId);
  const sorted = [...library].sort((a, b) => b.saved.localeCompare(a.saved));
  const open = (id: string, name: string) => {
    const s = useStore.getState();
    if (id !== current && isDirty(s) && !confirm(`The track "${s.name}" has unsaved changes. Open "${name}" anyway?`)) return;
    openSaved(id);
  };
  return (
    <>
      <h2>Open a saved track</h2>
      {sorted.length === 0 ? (
        <p className="muted">No saved tracks yet. Use File → Save, or import an exported HTML file.</p>
      ) : (
        <ul className="library">
          {sorted.map((e) => (
            <li key={e.id} className={e.id === current ? "current" : ""}>
              <button className="lib-open" onClick={() => open(e.id, e.name)}>
                <span className="lib-name">{e.name}</span>
                <span className="muted">
                  {e.track.stations.length} towns · {e.saved ? new Date(e.saved).toLocaleString() : ""}
                </span>
              </button>
              <button className="lib-delete" title="Delete from the library" aria-label={`Delete ${e.name}`} onClick={() => confirm(`Delete "${e.name}" from the library? This can't be undone.`) && deleteSaved(e.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions left">
        <button onClick={() => (useStore.setState({ dialog: null }), importFromPicker())}>Import file…</button>
      </div>
    </>
  );
}
