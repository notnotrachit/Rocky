use std::str::FromStr;

use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{models::CommandError, settings};

pub const VOICE_SHORTCUT_LABEL: &str = "voice-push-to-talk";
const VOICE_SHORTCUT_START_EVENT: &str = "voice-shortcut-start";
const VOICE_SHORTCUT_STOP_EVENT: &str = "voice-shortcut-stop";

pub fn plugin() -> tauri_plugin_global_shortcut::Builder<Wry> {
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
        let saved_shortcut = settings::read_voice_settings(app)
            .unwrap_or_default()
            .push_to_talk_shortcut;
        let Ok(active_shortcut) = parse_shortcut(&saved_shortcut) else {
            return;
        };

        if shortcut != &active_shortcut {
            return;
        }

        let event_name = match event.state {
            ShortcutState::Pressed => VOICE_SHORTCUT_START_EVENT,
            ShortcutState::Released => VOICE_SHORTCUT_STOP_EVENT,
        };

        if let Some(window) = app.get_webview_window("pet") {
            let _ = window.emit(event_name, VOICE_SHORTCUT_LABEL);
        } else {
            let _ = app.emit(event_name, VOICE_SHORTCUT_LABEL);
        }
    })
}

pub fn register_voice_shortcut(app: &AppHandle) -> Result<(), CommandError> {
    let settings = settings::read_voice_settings(app).unwrap_or_default();
    register_voice_shortcut_value(app, &settings.push_to_talk_shortcut)
}

pub fn register_voice_shortcut_value(app: &AppHandle, shortcut: &str) -> Result<(), CommandError> {
    let shortcut = parse_shortcut(shortcut)?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| CommandError::from(format!("Could not clear previous shortcut: {error}")))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|error| CommandError::from(format!("Could not register push-to-talk shortcut: {error}")))?;
    Ok(())
}

pub fn validate_shortcut(shortcut: &str) -> Result<(), CommandError> {
    parse_shortcut(shortcut).map(|_| ())
}

fn parse_shortcut(shortcut: &str) -> Result<Shortcut, CommandError> {
    Shortcut::from_str(&normalize_shortcut(shortcut)).map_err(|error| {
        CommandError::from(format!(
            "Invalid shortcut '{}'. Use a value like Option+Space, Command+Shift+R, or Control+Option+Space. Parser error: {error}",
            shortcut
        ))
    })
}

fn normalize_shortcut(shortcut: &str) -> String {
    shortcut
        .trim()
        .replace(' ', "")
        .replace("Option", "Alt")
        .replace("option", "Alt")
        .replace("Cmd", "Super")
        .replace("cmd", "Super")
        .replace("Command", "Super")
        .replace("command", "Super")
}
