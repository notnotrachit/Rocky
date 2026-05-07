use tauri::AppHandle;

use crate::{
    llm,
    macos,
    memory,
    models::{AccessibilityObservation, ActiveApp, CommandError, ControlSettings, MemoryItem, ObservePlanRequest, ObservePlanResult, OcrResult, OllamaHealth, OllamaModel, PetContext, PlanResult, VoiceModelInfo, VoiceSettings},
    ollama,
    shortcuts,
    settings,
    voice,
};

#[tauri::command]
pub async fn ollama_health() -> Result<OllamaHealth, CommandError> {
    ollama::health().await
}

#[tauri::command]
pub async fn ollama_models() -> Result<Vec<OllamaModel>, CommandError> {
    ollama::models().await
}

#[tauri::command]
pub async fn plan_pet_action(app: AppHandle, message: String, model: String, settings: ControlSettings, context: PetContext) -> Result<PlanResult, CommandError> {
    llm::plan_pet_action(app, message, model, settings, context).await
}

#[tauri::command]
pub fn active_app() -> Result<ActiveApp, CommandError> {
    macos::active_app()
}

#[tauri::command]
pub fn accessibility_status() -> bool {
    macos::accessibility_status()
}

#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    macos::request_accessibility_permission()
}

#[tauri::command]
pub fn accessibility_observation() -> Result<AccessibilityObservation, CommandError> {
    macos::accessibility_observation()
}

#[tauri::command]
pub fn read_screen_text() -> Result<OcrResult, CommandError> {
    macos::read_screen_text()
}

#[tauri::command]
pub async fn observe_and_plan(request: ObservePlanRequest) -> Result<ObservePlanResult, CommandError> {
    llm::observe_and_plan(request).await
}

#[tauri::command]
pub fn memories(app: AppHandle) -> Result<Vec<MemoryItem>, CommandError> {
    memory::list(&app)
}

#[tauri::command]
pub fn delete_memory(app: AppHandle, id: String) -> Result<(), CommandError> {
    memory::delete(&app, id)
}

#[tauri::command]
pub fn clear_memories(app: AppHandle) -> Result<(), CommandError> {
    memory::clear(&app)
}

#[tauri::command]
pub fn get_pet_scale(app: AppHandle) -> f64 {
    settings::read_pet_scale(&app).unwrap_or(1.0)
}

#[tauri::command]
pub fn set_pet_scale(app: AppHandle, scale: f64) {
    settings::save_pet_scale(&app, scale.clamp(0.6, 1.7));
}

#[tauri::command]
pub fn get_control_settings(app: AppHandle) -> ControlSettings {
    settings::read_control_settings(&app).unwrap_or_default()
}

#[tauri::command]
pub fn set_control_settings(app: AppHandle, settings: ControlSettings) {
    settings::save_control_settings(&app, settings);
}

#[tauri::command]
pub fn get_voice_settings(app: AppHandle) -> VoiceSettings {
    settings::read_voice_settings(&app).unwrap_or_default()
}

#[tauri::command]
pub fn set_voice_settings(app: AppHandle, settings: VoiceSettings) -> Result<(), CommandError> {
    shortcuts::register_voice_shortcut_value(&app, &settings.push_to_talk_shortcut)?;
    settings::save_voice_settings(&app, settings);
    Ok(())
}

#[tauri::command]
pub fn voice_models(app: AppHandle) -> Result<Vec<VoiceModelInfo>, CommandError> {
    voice::models(&app)
}

#[tauri::command]
pub async fn download_voice_model(app: AppHandle, model_id: String) -> Result<VoiceModelInfo, CommandError> {
    voice::download_model(app, model_id).await
}

#[tauri::command]
pub fn validate_voice_shortcut(shortcut: String) -> Result<(), CommandError> {
    shortcuts::validate_shortcut(&shortcut)
}

#[tauri::command]
pub fn start_voice_recording(app: AppHandle) -> Result<(), CommandError> {
    voice::start_recording(app)
}

#[tauri::command]
pub async fn stop_voice_recording_and_transcribe(app: AppHandle) -> Result<String, CommandError> {
    voice::stop_recording_and_transcribe(app).await
}
