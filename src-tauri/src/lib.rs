use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
mod db;

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("memoflow.sqlite"))
}


use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const BLACKBOARD_URL: &str = "https://bb.cuhk.edu.cn/";
const MAX_CAPTURE_BYTES: usize = 1_000_000;
const MAX_CAPTURE_ITEMS: usize = 5_000;

#[derive(Default)]
struct CaptureState {
    nonce: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct CaptureEnvelope {
    nonce: String,
    source: String,
    rows: Vec<CaptureRow>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct CaptureRow {
    #[serde(rename = "externalId")]
    external_id: Option<String>,
    #[serde(rename = "courseName")]
    course_name: String,
    #[serde(rename = "courseCode")]
    course_code: Option<String>,
    title: String,
    #[serde(rename = "itemType")]
    item_type: String,
    #[serde(rename = "dueAt")]
    due_at: String,
    #[serde(rename = "sourceUrl")]
    source_url: String,
}

#[tauri::command]
fn load_snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    let database = db::SnapshotDb::open(database_path(&app)?).map_err(|error| error.to_string())?;
    Ok(database.load_snapshot().map_err(|error| error.to_string())?.unwrap_or_else(|| serde_json::json!({
        "memos": [], "reminders": [], "blackboardItems": [], "syncRuns": [], "externalMappings": []
    })))
}

#[tauri::command]
fn save_snapshot(app: tauri::AppHandle, snapshot: Value) -> Result<(), String> {
    let mut database = db::SnapshotDb::open(database_path(&app)?).map_err(|error| error.to_string())?;
    database.save_snapshot(&snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_blackboard_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("blackboard") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let nonce = uuid::Uuid::new_v4().to_string();
    *state.nonce.lock().map_err(|_| "无法初始化导入会话".to_string())? = Some(nonce.clone());
    let event_app = app.clone();
    let expected_nonce = nonce;

    WebviewWindowBuilder::new(
        &app,
        "blackboard",
        WebviewUrl::External(BLACKBOARD_URL.parse::<Url>().map_err(|error| error.to_string())?),
    )
    .title("Blackboard 登录")
    .inner_size(1080.0, 820.0)
    .on_navigation(move |url| {
        if url.scheme() != "memoflow" {
            return true;
        }

        let query = url.query_pairs().collect::<Vec<_>>();
        let received_nonce = query.iter().find(|(key, _)| key == "nonce").map(|(_, value)| value.as_ref());
        let payload = query.iter().find(|(key, _)| key == "payload").map(|(_, value)| value.as_ref());
        if received_nonce != Some(expected_nonce.as_str()) {
            return false;
        }
        let Some(payload) = payload else {
            return false;
        };
        if payload.len() > MAX_CAPTURE_BYTES {
            return false;
        }

        let Ok(envelope) = serde_json::from_str::<CaptureEnvelope>(payload) else {
            return false;
        };
        if envelope.nonce != expected_nonce
            || envelope.rows.len() > MAX_CAPTURE_ITEMS
            || !(envelope.source == "https://bb.cuhk.edu.cn"
                || envelope.source == "https://sts.cuhk.edu.cn")
        {
            return false;
        }

        let _ = event_app.emit("blackboard-capture", envelope.rows.clone());
        false
    })
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn capture_blackboard_calendar(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("blackboard")
        .ok_or_else(|| "Blackboard 登录窗口尚未打开".to_string())?;
    let nonce = state
        .nonce
        .lock()
        .map_err(|_| "导入会话不可用".to_string())?
        .clone()
        .ok_or_else(|| "请先打开 Blackboard 登录窗口".to_string())?;
    let script = format!(
        r#"
      (() => {{
        const nodes = [...document.querySelectorAll('[data-calendar-item], [data-item-id], [data-due], [data-due-date], article, li, tr')];
        const rows = nodes.map((element) => {{
          const dueNode = element.querySelector('time[datetime], [data-due], [data-due-date]');
          const dueAt = dueNode?.getAttribute('datetime')
            || dueNode?.getAttribute('data-due')
            || dueNode?.getAttribute('data-due-date')
            || '';
          const title = (element.querySelector('a, h1, h2, h3, h4, strong')?.textContent || '').replace(/\s+/g, ' ').trim();
          if (!dueAt || !title) return null;
          const href = element.querySelector('a[href]')?.href || location.href;
          return {{
            externalId: element.getAttribute('data-item-id') || element.getAttribute('data-id') || element.id || null,
            courseName: element.getAttribute('data-course-name') || '未命名课程',
            courseCode: element.getAttribute('data-course-code') || null,
            title,
            itemType: element.getAttribute('data-item-type') || 'other',
            dueAt,
            sourceUrl: href
          }};
        }}).filter(Boolean);
        const envelope = {{ nonce: '{nonce}', source: location.origin, rows }};
        location.href = 'memoflow://capture?nonce={nonce}&payload=' + encodeURIComponent(JSON.stringify(envelope));
      }})();
    "#
    );
    window.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_blackboard_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    *state.nonce.lock().map_err(|_| "导入会话不可用".to_string())? = None;
    if let Some(window) = app.get_webview_window("blackboard") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_snapshot,
            save_snapshot,
            open_blackboard_window,
            capture_blackboard_calendar,
            clear_blackboard_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}





