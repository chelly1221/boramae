use std::fs;

/// 프론트에서 만든 텍스트(CSV 등)를 사용자가 고른 경로에 저장한다.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
