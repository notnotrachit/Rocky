import { getCurrentWindow } from "@tauri-apps/api/window";
import { ControlsApp } from "./windows/ControlsApp";
import { PetApp } from "./windows/PetApp";

export default function App() {
  return getCurrentWindow().label === "controls" ? <ControlsApp /> : <PetApp />;
}
