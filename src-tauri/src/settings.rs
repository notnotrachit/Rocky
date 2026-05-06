use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition};

use crate::models::{ControlSettings, SavedPetPosition, VoiceSettings};

pub fn restore_pet_position(app: &AppHandle) {
    let Some(window) = app.get_webview_window("pet") else {
        return;
    };
    let Some(position) = read_pet_position(app) else {
        return;
    };

    let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
}

pub fn save_pet_position(app: &AppHandle, position: PhysicalPosition<i32>) {
    let Some(path) = config_file(app, "window-position.json") else {
        return;
    };

    write_json(path, &SavedPetPosition { x: position.x, y: position.y });
}

pub fn read_pet_scale(app: &AppHandle) -> Option<f64> {
    let path = config_file(app, "pet-scale.json")?;
    let contents = fs::read_to_string(path).ok()?;
    contents.trim().parse::<f64>().ok()
}

pub fn save_pet_scale(app: &AppHandle, scale: f64) {
    let Some(path) = config_file(app, "pet-scale.json") else {
        return;
    };
    write_text(path, &scale.to_string());
}

pub fn read_control_settings(app: &AppHandle) -> Option<ControlSettings> {
    let path = config_file(app, "control-settings.json")?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn save_control_settings(app: &AppHandle, settings: ControlSettings) {
    let Some(path) = config_file(app, "control-settings.json") else {
        return;
    };
    write_json(path, &settings);
}

pub fn read_voice_settings(app: &AppHandle) -> Option<VoiceSettings> {
    let path = config_file(app, "voice-settings.json")?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn save_voice_settings(app: &AppHandle, settings: VoiceSettings) {
    let Some(path) = config_file(app, "voice-settings.json") else {
        return;
    };
    write_json(path, &settings);
}

fn read_pet_position(app: &AppHandle) -> Option<SavedPetPosition> {
    let path = config_file(app, "window-position.json")?;
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn config_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(name))
}

fn write_json<T: serde::Serialize>(path: PathBuf, value: &T) {
    if let Ok(json) = serde_json::to_string_pretty(value) {
        write_text(path, &json);
    }
}

fn write_text(path: PathBuf, value: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, value);
}
