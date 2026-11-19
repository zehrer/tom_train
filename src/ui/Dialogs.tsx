import { useStore } from "../model/store";
import { SHORTCUTS } from "./actions";
import { LIVE_URL, Logo, REPO_URL } from "./Header";

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        {dialog === "keys" ? (
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
