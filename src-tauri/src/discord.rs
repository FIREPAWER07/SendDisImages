use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serenity::all::{ChannelId, ChannelType, CreateAttachment, CreateMessage, GuildId, Http};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

#[derive(Clone)]
pub struct DiscordClient {
    http: Arc<Http>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    pub channel_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GuildInfo {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub channels: Vec<ChannelInfo>,
}

impl DiscordClient {
    pub fn new(token: String) -> Self {
        let http = Arc::new(Http::new(&token));
        Self { http }
    }

    pub async fn validate(&self) -> Result<bool> {
        match self.http.get_current_user().await {
            Ok(_) => Ok(true),
            Err(e) => Err(anyhow!("Invalid token: {}", e)),
        }
    }

    pub async fn get_guilds(&self) -> Result<Vec<GuildInfo>> {
        let guilds = self.http.get_guilds(None, None).await?;
        let mut guild_infos = Vec::new();

        for guild in guilds {
            let guild_id = GuildId::new(guild.id.get());

            // Get channels for this guild
            let channels = match self.http.get_channels(guild_id).await {
                Ok(channels) => channels
                    .into_iter()
                    .filter(|c| matches!(c.kind, ChannelType::Text | ChannelType::News))
                    .map(|c| ChannelInfo {
                        id: c.id.to_string(),
                        name: c.name,
                        channel_type: format!("{:?}", c.kind),
                    })
                    .collect(),
                Err(_) => Vec::new(),
            };

            guild_infos.push(GuildInfo {
                id: guild.id.to_string(),
                name: guild.name,
                icon: guild.icon.map(|i| i.to_string()),
                channels,
            });
        }

        Ok(guild_infos)
    }

    pub async fn send_message(
        &self,
        channel_id: u64,
        attachments: Vec<PathBuf>,
        send_separately: bool,
    ) -> Result<Vec<String>> {
        let channel = ChannelId::new(channel_id);
        let mut message_ids = Vec::new();

        if send_separately {
            // Send each image as a separate message
            for path in attachments {
                let attachment = CreateAttachment::path(&path).await?;
                let builder = CreateMessage::new().add_file(attachment);

                match channel.send_message(&self.http, builder).await {
                    Ok(msg) => message_ids.push(msg.id.to_string()),
                    Err(e) => return Err(anyhow!("Failed to send message: {}", e)),
                }
            }
        } else {
            // Send all images in one message
            let mut builder = CreateMessage::new();

            for path in attachments {
                let attachment = CreateAttachment::path(&path).await?;
                builder = builder.add_file(attachment);
            }

            match channel.send_message(&self.http, builder).await {
                Ok(msg) => message_ids.push(msg.id.to_string()),
                Err(e) => return Err(anyhow!("Failed to send message: {}", e)),
            }
        }

        Ok(message_ids)
    }
}

#[derive(Serialize, Deserialize)]
pub struct SendImagesRequest {
    pub token: String,
    pub channel_id: String,
    pub image_paths: Vec<String>,
    pub nitro_mode: bool,
    pub send_separately: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SendImagesResponse {
    pub success: bool,
    pub message_ids: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn initialize_bot(
    token: String,
    _state: State<'_, crate::AppState>,
) -> Result<bool, String> {
    let client = DiscordClient::new(token);

    match client.validate().await {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Failed to initialize bot: {}", e)),
    }
}

#[tauri::command]
pub async fn validate_token(token: String) -> Result<bool, String> {
    let client = DiscordClient::new(token);
    match client.validate().await {
        Ok(valid) => Ok(valid),
        Err(e) => Err(format!("Token validation failed: {}", e)),
    }
}

#[tauri::command]
pub async fn get_guilds_and_channels(token: String) -> Result<Vec<GuildInfo>, String> {
    let client = DiscordClient::new(token);
    match client.get_guilds().await {
        Ok(guilds) => Ok(guilds),
        Err(e) => Err(format!("Failed to fetch guilds: {}", e)),
    }
}

#[tauri::command]
pub async fn send_images(
    request: SendImagesRequest,
    _state: State<'_, crate::AppState>,
) -> Result<SendImagesResponse, String> {
    let client = DiscordClient::new(request.token);

    // Validate token first
    if let Err(e) = client.validate().await {
        return Err(format!("Invalid token: {}", e));
    }

    let channel_id: u64 = request
        .channel_id
        .parse()
        .map_err(|_| "Invalid channel ID".to_string())?;

    let max_size = if request.nitro_mode {
        500 * 1024 * 1024 // 500 MB
    } else {
        10 * 1024 * 1024 // 10 MB
    };

    let mut valid_paths = Vec::new();
    let mut skipped = Vec::new();
    let mut errors = Vec::new();

    // Process and compress images
    for path_str in request.image_paths {
        let path = PathBuf::from(&path_str);

        match crate::compression::process_image(&path, max_size).await {
            Ok(processed_path) => {
                valid_paths.push(processed_path);
            }
            Err(e) => {
                if e.to_string().contains("exceeds") {
                    skipped.push(format!("{}: {}", path_str, e));
                } else {
                    errors.push(format!("{}: {}", path_str, e));
                }
            }
        }
    }

    if valid_paths.is_empty() {
        return Ok(SendImagesResponse {
            success: false,
            message_ids: vec![],
            skipped,
            errors,
        });
    }

    // Send images
    match client
        .send_message(channel_id, valid_paths, request.send_separately)
        .await
    {
        Ok(message_ids) => Ok(SendImagesResponse {
            success: true,
            message_ids,
            skipped,
            errors,
        }),
        Err(e) => Err(format!("Failed to send images: {}", e)),
    }
}
