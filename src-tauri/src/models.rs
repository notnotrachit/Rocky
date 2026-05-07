use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetContext {
    pub mood: String,
    pub active_app: Option<String>,
    pub idle_seconds: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PetAction {
    pub mood: String,
    pub animation: String,
    pub speech: String,
    pub duration_ms: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealth {
    pub ready: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveApp {
    pub name: String,
    pub bundle_identifier: Option<String>,
    pub process_id: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityObservation {
    pub trusted: bool,
    pub active_app: Option<ActiveApp>,
    pub window_title: Option<String>,
    pub focused_role: Option<String>,
    pub focused_title: Option<String>,
    pub focused_value: Option<String>,
    pub selected_text: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservePlanRequest {
    pub settings: ControlSettings,
    pub mood: String,
    pub last_reaction_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservePlanResult {
    pub observation: AccessibilityObservation,
    pub sanitized_context: String,
    pub reaction_key: Option<String>,
    pub action: Option<PetAction>,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub modified_at: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    pub action: PetAction,
    pub memories_used: Vec<MemoryItem>,
    pub memories_saved: Vec<MemoryItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub message: String,
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self { message: message.to_string() }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct ControlSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub observation_enabled: bool,
    pub quiet_mode: bool,
    pub launch_at_login: bool,
    pub memory_enabled: bool,
    pub ocr_enabled: bool,
    pub ocr_observation_enabled: bool,
    pub ocr_observation_interval_minutes: u32,
}

impl Default for ControlSettings {
    fn default() -> Self {
        Self {
            provider: "ollama".to_string(),
            model: "llama3.2".to_string(),
            base_url: "http://127.0.0.1:11434".to_string(),
            api_key: String::new(),
            observation_enabled: false,
            quiet_mode: false,
            launch_at_login: false,
            memory_enabled: true,
            ocr_enabled: false,
            ocr_observation_enabled: false,
            ocr_observation_interval_minutes: 15,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub id: String,
    pub subject: String,
    pub fact: String,
    pub source: String,
    pub confidence: f64,
    pub created_at: u64,
    pub last_used_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCandidate {
    pub subject: String,
    pub fact: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryExtraction {
    pub should_remember: bool,
    pub memories: Vec<MemoryCandidate>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct VoiceSettings {
    pub selected_model: String,
    pub push_to_talk_shortcut: String,
    pub use_local_stt: bool,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            selected_model: "parakeet-tdt-0.6b-v3".to_string(),
            push_to_talk_shortcut: "Option+Space".to_string(),
            use_local_stt: true,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub engine: String,
    pub filename: String,
    pub url: String,
    pub size_mb: u32,
    pub is_recommended: bool,
    pub is_downloaded: bool,
    pub local_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub done: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedPetPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Serialize)]
pub struct GenerateRequest {
    pub model: String,
    pub prompt: String,
    pub stream: bool,
}

#[derive(Debug, Deserialize)]
pub struct GenerateResponse {
    pub response: String,
}
