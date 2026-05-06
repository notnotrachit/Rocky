use tauri::{Manager, Window, WindowEvent};

use crate::settings;

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "pet" {
        return;
    }

    match event {
        WindowEvent::Moved(position) => settings::save_pet_position(window.app_handle(), *position),
        WindowEvent::CloseRequested { .. } => {
            if let Ok(position) = window.outer_position() {
                settings::save_pet_position(window.app_handle(), position);
            }
        }
        _ => {}
    }
}
