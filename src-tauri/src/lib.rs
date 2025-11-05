// Tauri library exports
// This file is required for Tauri 2 to properly expose the library

pub mod compression;
pub mod discord;
pub mod storage;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct AppState {
    // Add any shared state here if needed
}

impl Default for AppState {
    fn default() -> Self {
        Self {}
    }
}
