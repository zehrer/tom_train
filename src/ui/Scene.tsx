import { useEffect, useRef } from "react";
import { World } from "../scene/world";

export function Scene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const world = new World(host.current!);
    return () => world.dispose();
  }, []);
  return <div className="scene" ref={host} />;
}
