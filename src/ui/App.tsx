import { useEffect } from "react";
import { useStore } from "../model/store";
import { onKey } from "./actions";
import { Dialogs } from "./Dialogs";
import { Header } from "./Header";
import { Scene } from "./Scene";
import { Status } from "./Status";
import { EditorBar, SimulatorBar } from "./Toolbar";

export function App() {
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="app">
      <Header />
      {mode === "editor" ? <EditorBar /> : <SimulatorBar />}
      <main>
        <Scene />
        <Status />
      </main>
      <Dialogs />
    </div>
  );
}
