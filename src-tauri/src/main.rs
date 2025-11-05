#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod compression;
mod discord;
mod storage;

#[derive(Default)]
struct AppState {}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            discord::initialize_bot,
            discord::send_images,
            discord::validate_token,
            discord::get_guilds_and_channels, // Added new command
            storage::save_token,
            storage::load_token,
            storage::clear_token,
            storage::save_channel, // Added new commands
            storage::load_channel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
