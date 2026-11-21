import { useEffect } from "react";
import { useStore } from "../model/store";
import { onKey } from "./actions";
import { acceptHandover } from "./files";
import { Dialogs } from "./Dialogs";
import { Header } from "./Header";
import { PhoneControls, PhoneHeader, usePhone } from "./Phone";
import { Scene } from "./Scene";
import { Status } from "./Status";
import { EditorBar, SimulatorBar } from "./Toolbar";

export function App() {
  const mode = useStore((s) => s.mode);
  const phone = usePhone();
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    acceptHandover();
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (phone)
    return (
      <div className="app phone">
        <PhoneHeader />
        <main>
          <Scene />
          <Status />
          <PhoneControls />
        </main>
        <Dialogs />
      </div>
    );
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
