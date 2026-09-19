#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod capture;

#[tauri::command]
async fn capture_probe() -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(capture::probe)
            .await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    Err("Windows Graphics Capture exige Windows.".into())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![capture_probe])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar Viewera");
}
