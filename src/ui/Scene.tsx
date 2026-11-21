import { useEffect, useRef } from "react";
import { World } from "../scene/world";

export function Scene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const world = new World(host.current!);
    // Handy for looking into the scene from the browser console while developing.
    if (import.meta.env.DEV) (window as unknown as { world: World }).world = world;
    return () => world.dispose();
  }, []);
  return <div className="scene" ref={host} />;
}
