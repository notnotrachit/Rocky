import { invoke } from "@tauri-apps/api/core";
import type { AccessibilityObservation, ActiveApp, ControlSettings, MemoryItem, ObservePlanResult, OcrResult, OllamaHealth, OllamaModel, PetAction, PetMood, PlanResult, VoiceModelInfo, VoiceSettings } from "../types";

export function getPetScale() {
  return invoke<number>("get_pet_scale");
}

export function setPetScale(scale: number) {
  return invoke("set_pet_scale", { scale });
}

export function getControlSettings() {
  return invoke<ControlSettings>("get_control_settings");
}

export function setControlSettings(settings: ControlSettings) {
  return invoke("set_control_settings", { settings });
}

export function getOllamaHealth() {
  return invoke<OllamaHealth>("ollama_health");
}

export function getOllamaModels() {
  return invoke<OllamaModel[]>("ollama_models");
}

export function planPetAction(input: { message: string; model: string; settings: ControlSettings; context: { mood: PetMood; activeApp: string | null; idleSeconds: number } }) {
  return invoke<PlanResult>("plan_pet_action", input);
}

export function getActiveApp() {
  return invoke<ActiveApp>("active_app");
}

export function getAccessibilityStatus() {
  return invoke<boolean>("accessibility_status");
}

export function requestAccessibilityPermission() {
  return invoke<boolean>("request_accessibility_permission");
}

export function getAccessibilityObservation() {
  return invoke<AccessibilityObservation>("accessibility_observation");
}

export function readScreenText() {
  return invoke<OcrResult>("read_screen_text");
}

export function observeAndPlan(input: { settings: ControlSettings; mood: PetMood; lastReactionKey: string | null }) {
  return invoke<ObservePlanResult>("observe_and_plan", { request: input });
}

export function getMemories() {
  return invoke<MemoryItem[]>("memories");
}

export function deleteMemory(id: string) {
  return invoke("delete_memory", { id });
}

export function clearMemories() {
  return invoke("clear_memories");
}

export function getVoiceSettings() {
  return invoke<VoiceSettings>("get_voice_settings");
}

export function setVoiceSettings(settings: VoiceSettings) {
  return invoke("set_voice_settings", { settings });
}

export function validateVoiceShortcut(shortcut: string) {
  return invoke("validate_voice_shortcut", { shortcut });
}

export function getVoiceModels() {
  return invoke<VoiceModelInfo[]>("voice_models");
}

export function downloadVoiceModel(modelId: string) {
  return invoke<VoiceModelInfo>("download_voice_model", { modelId });
}

export function startVoiceRecording() {
  return invoke("start_voice_recording");
}

export function stopVoiceRecordingAndTranscribe() {
  return invoke<string>("stop_voice_recording_and_transcribe");
}

export function emitPetAction(action: PetAction) {
  return import("@tauri-apps/api/event").then(({ emit }) => emit("pet-action", action));
}

export function emitPetScale(scale: number) {
  return import("@tauri-apps/api/event").then(({ emit }) => emit("pet-scale", scale));
}

export function emitClickThrough(enabled: boolean) {
  return import("@tauri-apps/api/event").then(({ emit }) => emit("pet-click-through", enabled));
}
