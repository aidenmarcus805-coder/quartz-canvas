pub mod ai;
pub mod app_state;
pub mod bootstrap;
pub mod commands;
pub mod context;
pub mod dev_server;
pub mod diagnostics;
pub mod domain;
pub mod error;
pub mod events;
pub mod fs;
pub mod indexer;
pub mod patch;
pub mod project;
pub mod runtime;
pub mod security;
pub mod storage;

use tauri::{Emitter, Manager};

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let deep_links: Vec<String> = args
                .into_iter()
                .filter(|arg| {
                    arg.starts_with("quartz-canvas://")
                        || arg.starts_with("quartz://")
                        || arg.starts_with("autocut://")
                })
                .collect();

            if deep_links.is_empty() {
                return;
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.emit("deep_link_from_args", deep_links);
            }
        }))
        .setup(bootstrap::setup)
        .invoke_handler(tauri::generate_handler![
            commands::ai::ensure_ollama_gguf_model,
            commands::ai::generate_ollama_chat,
            commands::ai::get_ai_status,
            commands::ai::get_default_model_directory,
            commands::ai::list_ai_model_profiles,
            commands::ai::open_model_directory,
            commands::ai::plan_ai_model_import,
            commands::ai::plan_ai_model_runtime,
            commands::ai::plan_qwopus_model_runtime,
            commands::ai::propose_ui_change,
            commands::ai::search_hugging_face_gguf_models,
            commands::ai::unload_ollama_model,
            commands::auth::get_auth_session,
            commands::auth::open_auth_url,
            commands::auth::sign_out,
            commands::auth::verify_license_key,
            commands::dev_server::get_dev_server_status,
            commands::dev_server::restart_dev_server,
            commands::dev_server::start_dev_server,
            commands::dev_server::stop_dev_server,
            commands::diagnostics::redact_diagnostic,
            commands::indexer::get_index_status,
            commands::indexer::refresh_source_index,
            commands::patch::apply_patch,
            commands::patch::rollback_patch,
            commands::patch::rollback_patch_stack,
            commands::patch::validate_patch,
            commands::preview::fetch_preview_document,
            commands::preview::scan_localhost_projects,
            commands::project::close_project,
            commands::project::get_project_status,
            commands::project::open_project,
            commands::project::open_project_in_explorer,
        ])
        .run(tauri::generate_context!())
}
