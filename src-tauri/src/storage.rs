use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

#[derive(Serialize, Deserialize)]
struct StoredData {
    token: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChannelData {
    channel_id: String,
    channel_name: String,
    guild_name: String,
}

#[tauri::command]
pub async fn save_token(app: AppHandle, token: String) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set("discord_token", serde_json::json!({ "token": token }));

    store
        .save()
        .map_err(|e| format!("Failed to persist token: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn load_token(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    match store.get("discord_token") {
        Some(value) => {
            let data: StoredData = serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to parse token: {}", e))?;
            Ok(Some(data.token))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn clear_token(app: AppHandle) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    let deleted = store.delete("discord_token");

    if !deleted {
        return Err("Token not found".to_string());
    }

    store
        .save()
        .map_err(|e| format!("Failed to persist changes: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn save_channel(
    app: AppHandle,
    channel_id: String,
    channel_name: String,
    guild_name: String,
) -> Result<(), String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    store.set(
        "selected_channel",
        serde_json::json!({
            "channel_id": channel_id,
            "channel_name": channel_name,
            "guild_name": guild_name
        }),
    );

    store
        .save()
        .map_err(|e| format!("Failed to persist channel: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn load_channel(app: AppHandle) -> Result<Option<ChannelData>, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    match store.get("selected_channel") {
        Some(value) => {
            let data: ChannelData = serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to parse channel: {}", e))?;
            Ok(Some(data))
        }
        _ => Ok(None),
    }
}
