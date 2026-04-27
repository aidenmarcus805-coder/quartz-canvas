use tauri::{Listener, Manager};

use crate::app_state::AppState;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;

        if let Err(error) = app.deep_link().register_all() {
            eprintln!("failed to register Quartz Canvas deep links: {error}");
        }
    }

    let app_data_dir = app.path().app_data_dir()?;
    let state = tauri::async_runtime::block_on(AppState::new(app_data_dir))?;
    app.manage(state);

    let app_handle = app.handle().clone();
    let ready_handle = app_handle.clone();
    app_handle.once_any("quartz-canvas:app-ready", move |_| {
        if let Some(main_window) = ready_handle.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }

        if let Some(splash_window) = ready_handle.get_webview_window("splashscreen") {
            let _ = splash_window.close();
        }
    });

    Ok(())
}
