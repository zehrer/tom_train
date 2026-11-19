import { useStore } from "../model/store";
import { SHORTCUTS } from "./actions";
import { Logo } from "./Header";

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
            <p>Build a railway in 3D and ride along in the driver's cab. Everything runs in your browser; your track is saved there.</p>
            <p className="muted">Version {__APP_VERSION__} · {__APP_BUILD__}</p>
          </>
        )}
        <div className="dialog-actions"><button onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
