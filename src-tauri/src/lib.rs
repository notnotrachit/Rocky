mod commands;
mod llm;
mod macos;
mod memory;
mod models;
mod ollama;
mod shortcuts;
mod settings;
mod voice;
mod window_state;

pub fn run() {
    tauri::Builder::default()
        .plugin(shortcuts::plugin().build())
        .setup(|app| {
            settings::restore_pet_position(app.handle());
            if let Err(error) = shortcuts::register_voice_shortcut(app.handle()) {
                eprintln!("Could not register Rocky voice shortcut: {}", error.message);
            }
            Ok(())
        })
        .on_window_event(window_state::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::ollama_health,
            commands::ollama_models,
            commands::plan_pet_action,
            commands::active_app,
            commands::accessibility_status,
            commands::request_accessibility_permission,
            commands::accessibility_observation,
            commands::observe_and_plan,
            commands::memories,
            commands::delete_memory,
            commands::clear_memories,
            commands::get_pet_scale,
            commands::set_pet_scale,
            commands::get_control_settings,
            commands::set_control_settings,
            commands::get_voice_settings,
            commands::set_voice_settings,
            commands::voice_models,
            commands::download_voice_model,
            commands::validate_voice_shortcut,
            commands::start_voice_recording,
            commands::stop_voice_recording_and_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rocky");
}
