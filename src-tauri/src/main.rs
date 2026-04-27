#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = quartz_canvas_lib::run() {
        eprintln!("failed to run Quartz Canvas: {error}");
        std::process::exit(1);
    }
}
