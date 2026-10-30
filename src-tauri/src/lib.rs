use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
mod db;

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("memoflow.sqlite"))
}

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

const BLACKBOARD_URL: &str = "https://bb.cuhk.edu.cn/";
const MAX_CAPTURE_BYTES: usize = 1_000_000;
const MAX_CAPTURE_ITEMS: usize = 5_000;
const MAX_SCHEDULE_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const PUSHPLUS_ENDPOINT: &str = "https://www.pushplus.plus/send";
const INBOUND_MAX_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct PushPlusMessage {
    token: String,
    title: String,
    content: String,
    channel: String,
    template: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct PushPlusResponse {
    code: i64,
    msg: String,
    #[serde(default)]
    data: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DshWxbridgeMessage {
    text: String,
    host: String,
    port: u16,
    #[serde(rename = "peerId", default)]
    peer_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DshQueueResponse {
    ok: bool,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct DshDeliveryResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct DshPreflightCheck {
    name: String,
    ok: bool,
    detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct DshPreflightResult {
    ok: bool,
    port: Option<u16>,
    message: String,
    checks: Vec<DshPreflightCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InboundConfig {
    version: u8,
    host: String,
    port: u16,
    token: String,
    pid: u32,
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(rename = "healthPath")]
    health_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct InboundReminderValidation {
    status: String,
    title: String,
    body: String,
    due_at: Option<String>,
    recurrence_rule: Option<String>,
    external_id: Option<String>,
}

fn inbound_text(value: Option<&Value>, field: &str, max: usize) -> Result<String, String> {
    let Some(value) = value else { return Ok(String::new()); };
    let text = value.as_str().ok_or_else(|| format!("{field} 格式无效"))?.trim().to_string();
    if text.chars().count() > max { return Err(format!("{field} 过长")); }
    Ok(text)
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' || !bytes.iter().enumerate().all(|(i, byte)| i == 4 || i == 7 || byte.is_ascii_digit()) { return false; }
    let year = value[0..4].parse::<u16>().ok();
    let month = value[5..7].parse::<u8>().ok();
    let day = value[8..10].parse::<u8>().ok();
    let (Some(year), Some(month), Some(day)) = (year, month, day) else { return false; };
    if year < 2000 || !(1..=12).contains(&month) || day == 0 { return false; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month { 2 if leap => 29, 2 => 28, 4 | 6 | 9 | 11 => 30, _ => 31 };
    day <= days
}

fn normalize_inbound_due_at(value: &str) -> Result<String, String> {
    let value = value.trim();
    let (date, time_and_zone) = value.split_once('T').ok_or_else(|| "提醒时间必须是 ISO 日期时间".to_string())?;
    if !valid_date(date) { return Err("提醒日期无效".to_string()); }
    let mut time = time_and_zone;
    if let Some(stripped) = time.strip_suffix('Z') { time = stripped; }
    if let Some((local, _offset)) = time.split_once('+') { time = local; }
    if let Some((local, _offset)) = time.rsplit_once('-') {
        if local.len() >= 5 && local.as_bytes().get(local.len() - 3) == Some(&b':') { time = local; }
    }
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 { return Err("提醒时间无效".to_string()); }
    let hour = parts[0].parse::<u8>().map_err(|_| "提醒时间无效".to_string())?;
    let minute = parts[1].parse::<u8>().map_err(|_| "提醒时间无效".to_string())?;
    let second = if parts.len() == 3 { parts[2].parse::<u8>().map_err(|_| "提醒时间无效".to_string())? } else { 0 };
    if hour > 23 || minute > 59 || second > 59 { return Err("提醒时间无效".to_string()); }
    Ok(format!("{date}T{hour:02}:{minute:02}:{second:02}+08:00"))
}

fn validate_inbound_reminder_payload(payload: &Value) -> Result<InboundReminderValidation, String> {
    let object = payload.as_object().ok_or_else(|| "请求必须是 JSON 对象".to_string())?;
    let allowed = ["title", "body", "dueAt", "date", "time", "timeOfDay", "recurrenceRule", "externalId", "source"];
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) { return Err(format!("不支持的字段：{key}")); }
    let title = inbound_text(object.get("title"), "title", 200)?;
    if title.is_empty() { return Err("事项名称不能为空".to_string()); }
    let body = inbound_text(object.get("body"), "body", 10_000)?;
    let date = inbound_text(object.get("date"), "date", 10)?;
    let time = inbound_text(object.get("time"), "time", 5)?;
    let time_of_day = inbound_text(object.get("timeOfDay"), "timeOfDay", 30)?;
    if !time_of_day.is_empty() && !["morning", "afternoon", "evening", "night"].contains(&time_of_day.as_str()) { return Err("timeOfDay 格式无效".to_string()); }
    let mut due_at = inbound_text(object.get("dueAt"), "dueAt", 80)?;
    if due_at.is_empty() {
        if date.is_empty() { return Err("缺少日期，请先补充具体日期和时间".to_string()); }
        if !valid_date(&date) { return Err("提醒日期无效".to_string()); }
        if time.is_empty() {
            return Ok(InboundReminderValidation { status: "needs_confirmation".to_string(), title, body, due_at: None, recurrence_rule: None, external_id: None });
        }
        due_at = format!("{date}T{time}");
    }
    let due_at = normalize_inbound_due_at(&due_at)?;
    let recurrence_rule = match object.get("recurrenceRule") {
        None | Some(Value::Null) => None,
        Some(value) => Some(inbound_text(Some(value), "recurrenceRule", 200)?),
    };
    let external_id = match object.get("externalId") {
        None | Some(Value::Null) => None,
        Some(value) => Some(inbound_text(Some(value), "externalId", 200)?),
    };
    Ok(InboundReminderValidation { status: "ready".to_string(), title, body, due_at: Some(due_at), recurrence_rule, external_id })
}

fn html_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;").replace('\n', "<br>")
}

fn now_rfc3339() -> String {
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_secs()).unwrap_or_default() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month_part = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * month_part + 2).div_euclid(5) + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", day_seconds / 3600, (day_seconds % 3600) / 60, day_seconds % 60)
}

fn create_inbound_reminder_snapshot(path: &Path, request: &InboundReminderValidation) -> Result<Value, String> {
    let due_at = request.due_at.clone().ok_or_else(|| "缺少提醒时间".to_string())?;
    let mut database = db::SnapshotDb::open(path).map_err(|error| error.to_string())?;
    let mut snapshot = database.load_snapshot().map_err(|error| error.to_string())?.unwrap_or_else(|| serde_json::json!({ "memos": [], "reminders": [], "blackboardItems": [], "courseSchedules": [], "countdowns": [], "syncRuns": [], "externalMappings": [] }));
    let object = snapshot.as_object_mut().ok_or_else(|| "快照格式无效".to_string())?;
    let mut memos = object.remove("memos").and_then(|value| value.as_array().cloned()).ok_or_else(|| "快照缺少 memos".to_string())?;
    let mut reminders = object.remove("reminders").and_then(|value| value.as_array().cloned()).ok_or_else(|| "快照缺少 reminders".to_string())?;
    let timestamp = now_rfc3339();
    let existing_memo_index = request.external_id.as_ref().and_then(|external_id| memos.iter().position(|memo| memo.get("externalItemId").and_then(Value::as_str) == Some(external_id)));
    let memo_id = if let Some(index) = existing_memo_index {
        let memo = memos.get_mut(index).ok_or_else(|| "快照记录无效".to_string())?;
        let memo_id = memo.get("id").and_then(Value::as_str).ok_or_else(|| "备忘录缺少 id".to_string())?.to_string();
        memo["title"] = Value::String(request.title.clone());
        memo["richText"] = Value::String(if request.body.is_empty() { format!("<p>{}</p>", html_escape(&request.title)) } else { format!("<p>{}</p>", html_escape(&request.body)) });
        memo["updatedAt"] = Value::String(timestamp.clone());
        memo_id
    } else {
        let memo_id = format!("memo_{}", uuid::Uuid::new_v4());
        memos.insert(0, serde_json::json!({
            "id": memo_id, "title": request.title, "richText": if request.body.is_empty() { format!("<p>{}</p>", html_escape(&request.title)) } else { format!("<p>{}</p>", html_escape(&request.body)) },
            "categoryId": null, "tags": ["dsh"], "source": "manual", "externalItemId": request.external_id,
            "sourceUrl": null, "createdAt": timestamp, "updatedAt": timestamp
        }));
        memo_id
    };
    let existing_reminder_index = reminders.iter().position(|reminder| reminder.get("memoId").and_then(Value::as_str) == Some(memo_id.as_str()));
    let reminder_id = if let Some(index) = existing_reminder_index {
        let reminder = reminders.get_mut(index).ok_or_else(|| "快照记录无效".to_string())?;
        let reminder_id = reminder.get("id").and_then(Value::as_str).ok_or_else(|| "提醒缺少 id".to_string())?.to_string();
        reminder["title"] = Value::String(request.title.clone());
        reminder["dueAt"] = Value::String(due_at.clone());
        reminder["recurrenceRule"] = request.recurrence_rule.clone().map(Value::String).unwrap_or(Value::Null);
        reminder["status"] = Value::String("pending".to_string());
        reminder["notificationSentAt"] = Value::Null;
        reminder["updatedAt"] = Value::String(timestamp);
        reminder_id
    } else {
        let reminder_id = format!("reminder_{}", uuid::Uuid::new_v4());
        reminders.push(serde_json::json!({
            "id": reminder_id, "memoId": memo_id, "title": request.title, "dueAt": due_at,
            "recurrenceRule": request.recurrence_rule, "status": "pending", "notificationSentAt": null,
            "delivery": { "nativeSentAt": null, "pushplusSentAt": null, "pushplusLastError": null, "dshQueuedFile": null, "dshSentAt": null, "dshLastError": null },
            "recurrenceAnchorAt": due_at, "occurrenceHistory": [], "createdAt": timestamp, "updatedAt": timestamp
        }));
        reminder_id
    };
    object.insert("memos".to_string(), Value::Array(memos));
    object.insert("reminders".to_string(), Value::Array(reminders));
    database.save_snapshot(&snapshot).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "status": "created", "id": reminder_id, "memoId": memo_id, "title": request.title, "dueAt": due_at }))
}

fn inbound_config_path(database: &Path) -> PathBuf {
    database.parent().unwrap_or_else(|| Path::new(".")).join("dsh-inbound.json")
}

fn build_inbound_config(port: u16, token: &str) -> Result<InboundConfig, String> {
    if port == 0 {
        return Err("MemoFlow 入站端口无效".to_string());
    }
    let token = token.trim();
    if token.is_empty() {
        return Err("MemoFlow 入站令牌不能为空".to_string());
    }
    Ok(InboundConfig {
        version: 1,
        host: "127.0.0.1".to_string(),
        port,
        token: token.to_string(),
        pid: std::process::id(),
        started_at: now_rfc3339(),
        health_path: "/api/dsh/health".to_string(),
    })
}

fn write_inbound_config(path: &Path, config: &InboundConfig) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| format!("无法创建 MemoFlow 本地工具配置目录：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temporary).map_err(|error| format!("无法写入 MemoFlow 本地工具配置：{error}"))?;
        file.write_all(&bytes).map_err(|error| format!("无法写入 MemoFlow 本地工具配置：{error}"))?;
        file.sync_all().map_err(|error| format!("无法保存 MemoFlow 本地工具配置：{error}"))?;
        // Windows cannot rename over an existing file. Remove only the old
        // config after the complete temporary file is durable, so a partial
        // JSON document is never exposed to the MCP process.
        let _ = fs::remove_file(path);
        fs::rename(&temporary, path).map_err(|error| format!("无法替换 MemoFlow 本地工具配置：{error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn inbound_health_payload(port: u16, started_at: &str, pid: u32) -> Value {
    serde_json::json!({
        "status": "ok",
        "service": "memoflow-inbound",
        "version": 1,
        "host": "127.0.0.1",
        "port": port,
        "pid": pid,
        "startedAt": started_at,
    })
}

fn remove_inbound_config(database: &Path) {
    let _ = fs::remove_file(inbound_config_path(database));
    let _ = fs::remove_file(inbound_config_path(database).with_extension("json.tmp"));
}

fn write_http_json(stream: &mut TcpStream, status: &str, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let header = format!("HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(header.as_bytes()).map_err(|error| error.to_string())?;
    stream.write_all(&body).map_err(|error| error.to_string())
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String, String, Vec<u8>), String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 { return Err("请求为空".to_string()); }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > INBOUND_MAX_BODY_BYTES + 16 * 1024 { return Err("请求过大".to_string()); }
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") { break index; }
    };
    let header_text = std::str::from_utf8(&buffer[..header_end]).map_err(|_| "请求头无效".to_string())?;
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or_else(|| "请求行缺失".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();
    let mut token = String::new();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("authorization") { token = value.trim().to_string(); }
            if name.eq_ignore_ascii_case("content-length") { content_length = value.trim().parse().map_err(|_| "Content-Length 无效".to_string())?; }
        }
    }
    if content_length > INBOUND_MAX_BODY_BYTES { return Err("请求体过大".to_string()); }
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 { return Err("请求体不完整".to_string()); }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok((method, path, token, buffer[body_start..body_start + content_length].to_vec()))
}

fn handle_inbound_connection(mut stream: TcpStream, token: &str, database: &Path, port: u16, started_at: &str, pid: u32, event_app: Option<&tauri::AppHandle>) {
    let result = (|| -> Result<(), String> {
        let (method, path, authorization, body) = read_http_request(&mut stream)?;
        if method == "OPTIONS" { return write_http_json(&mut stream, "204 No Content", &serde_json::json!({})); }
        if authorization != format!("Bearer {token}") { return write_http_json(&mut stream, "401 Unauthorized", &serde_json::json!({ "status": "error", "message": "本机工具令牌无效" })); }
        if path == "/api/dsh/health" {
            if method != "GET" { return write_http_json(&mut stream, "405 Method Not Allowed", &serde_json::json!({ "status": "error", "message": "健康检查只支持 GET" })); }
            return write_http_json(&mut stream, "200 OK", &inbound_health_payload(port, started_at, pid));
        }
        if path != "/api/dsh/tools/create-reminder" { return write_http_json(&mut stream, "404 Not Found", &serde_json::json!({ "status": "error", "message": "工具路径不存在" })); }
        if method != "POST" { return write_http_json(&mut stream, "405 Method Not Allowed", &serde_json::json!({ "status": "error", "message": "工具路径只支持 POST" })); }
        let payload = serde_json::from_slice::<Value>(&body).map_err(|_| "请求体必须是 JSON".to_string());
        let payload = match payload {
            Ok(payload) => payload,
            Err(error) => return write_http_json(&mut stream, "400 Bad Request", &serde_json::json!({ "status": "error", "message": error })),
        };
        let validation = match validate_inbound_reminder_payload(&payload) {
            Ok(value) => value,
            Err(error) => return write_http_json(&mut stream, "400 Bad Request", &serde_json::json!({ "status": "error", "message": error })),
        };
        if validation.status == "needs_confirmation" {
            return write_http_json(&mut stream, "200 OK", &serde_json::json!({ "status": "needs_confirmation", "title": validation.title, "message": "已识别日期，但缺少具体时间，请补充几点几分。" }));
        }
        let result = create_inbound_reminder_snapshot(database, &validation)?;
        if let Some(app) = event_app {
            let _ = app.emit("dsh-inbound-created", result.clone());
        }
        write_http_json(&mut stream, "200 OK", &result)
    })();
    if let Err(error) = result {
        let _ = write_http_json(&mut stream, "500 Internal Server Error", &serde_json::json!({ "status": "error", "message": error }));
    }
}

fn start_inbound_server(app: tauri::AppHandle) -> Result<(), String> {
    let database = database_path(&app)?;
    // Never leave a previous process's endpoint advertised while this
    // process is still trying to bind and publish its own listener.
    remove_inbound_config(&database);
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| format!("无法启动 MemoFlow 本地工具：{error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let token = uuid::Uuid::new_v4().to_string();
    let config_path = inbound_config_path(&database);
    let config = build_inbound_config(port, &token)?;
    let started_at = config.started_at.clone();
    let pid = config.pid;
    write_inbound_config(&config_path, &config)?;
    let thread_database = database.clone();
    let event_app = app.clone();
    let thread_result = thread::Builder::new().name("memoflow-inbound".to_string()).spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue; };
            let token = token.clone();
            let database = database.clone();
            let started_at = started_at.clone();
            let event_app = event_app.clone();
            let _ = thread::Builder::new().name("memoflow-inbound-request".to_string()).spawn(move || handle_inbound_connection(stream, &token, &database, port, &started_at, pid, Some(&event_app)));
        }
    });
    if let Err(error) = thread_result {
        remove_inbound_config(&thread_database);
        return Err(error.to_string());
    }
    Ok(())
}

fn validate_dsh_host(host: &str) -> Result<&str, String> {
    match host.trim().to_ascii_lowercase().as_str() {
        "127.0.0.1" | "localhost" => Ok(if host.trim().eq_ignore_ascii_case("localhost") { "localhost" } else { "127.0.0.1" }),
        _ => Err("DSH 只允许连接本机回环地址".to_string()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DshEndpoint {
    host: String,
    port: u16,
}

fn dsh_home_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法确定用户目录".to_string())?;
    Ok(PathBuf::from(home).join(".dsh"))
}

fn parse_dsh_url(value: &str) -> Option<DshEndpoint> {
    let value = value.trim();
    let without_scheme = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))?;
    let authority = without_scheme.split('/').next()?.trim();
    let (host, port) = authority.rsplit_once(':')?;
    let host = host.trim().to_ascii_lowercase();
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    let port = port.parse::<u16>().ok()?;
    if port == 0 {
        return None;
    }
    Some(DshEndpoint { host, port })
}

fn parse_dsh_address_file(value: &Value) -> Vec<DshEndpoint> {
    fn visit(value: &Value, inherited_host: Option<&str>, found: &mut Vec<DshEndpoint>) {
        match value {
            Value::String(text) => {
                if let Some(endpoint) = parse_dsh_url(text) {
                    found.push(endpoint);
                }
            }
            Value::Object(object) => {
                let host = object
                    .get("host")
                    .or_else(|| object.get("hostname"))
                    .and_then(Value::as_str)
                    .or(inherited_host);
                for key in ["url", "baseUrl", "endpoint", "address", "httpUrl", "http_url"] {
                    if let Some(text) = object.get(key).and_then(Value::as_str) {
                        if let Some(endpoint) = parse_dsh_url(text) {
                            found.push(endpoint);
                        }
                    }
                }
                for key in ["port", "httpPort", "listenPort", "wxbridgePort", "wxBridgePort"] {
                    if let Some(port) = object.get(key).and_then(|value| {
                        value
                            .as_u64()
                            .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
                    }) {
                        if let Ok(port) = u16::try_from(port) {
                            if port > 0 {
                                let host = host.unwrap_or("127.0.0.1").trim().to_ascii_lowercase();
                                if host == "127.0.0.1" || host == "localhost" {
                                    found.push(DshEndpoint { host, port });
                                }
                            }
                        }
                    }
                }
                for child in object.values() {
                    visit(child, host, found);
                }
            }
            Value::Array(values) => {
                for child in values {
                    visit(child, inherited_host, found);
                }
            }
            _ => {}
        }
    }

    let mut found = Vec::new();
    visit(value, None, &mut found);
    found.sort_by(|left, right| left.host.cmp(&right.host).then(left.port.cmp(&right.port)));
    found.dedup();
    found
}

fn dsh_endpoint_candidates(host: &str, requested_port: u16) -> Result<Vec<DshEndpoint>, String> {
    let host = validate_dsh_host(host)?.to_string();
    let mut candidates = Vec::new();
    let home = dsh_home_dir()?;
    let mut discovered = Vec::new();
    for path in [home.join("host-address.json"), home.join("wxbridge").join("host-address.json")] {
        let Ok(serialized) = fs::read_to_string(&path) else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&serialized) else { continue };
        discovered.extend(parse_dsh_address_file(&value));
    }
    if requested_port > 0 && requested_port != 7239 {
        candidates.push(DshEndpoint { host: host.clone(), port: requested_port });
    }
    candidates.extend(discovered);
    if requested_port == 0 || requested_port == 7239 {
        candidates.push(DshEndpoint { host, port: requested_port.max(7239) });
    }
    candidates.retain(|candidate| candidate.host == "127.0.0.1" || candidate.host == "localhost");
    candidates.dedup();
    if candidates.is_empty() {
        return Err("未发现可用的 DSH 本机端口，请先启动 DSH 微信桥".to_string());
    }
    Ok(candidates)
}

/// Resolve the active paired WeChat conversation from the bridge's local state.
///
/// The bridge accepts an omitted `to` field, but that route is only a UI/default
/// route and is not guaranteed to be the paired personal conversation. When the
/// user has one paired peer, selecting it here makes desktop notifications reach
/// the same conversation used by inbound messages without requiring the user to
/// copy an internal peer id into MemoFlow settings.
fn resolve_dsh_peer_id_from_state(value: &Value) -> Option<String> {
    fn non_empty(value: Option<&Value>) -> Option<String> {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    }

    if let Some(peer) = non_empty(value.get("lastPeer")) {
        return Some(peer);
    }

    let mut allowed = Vec::new();
    match value.get("allowedUsers") {
        Some(Value::String(peer)) if !peer.trim().is_empty() => allowed.push(peer.trim().to_string()),
        Some(Value::Array(peers)) => {
            for peer in peers.iter().filter_map(Value::as_str).map(str::trim).filter(|peer| !peer.is_empty()) {
                if !allowed.iter().any(|item| item == peer) {
                    allowed.push(peer.to_string());
                }
            }
        }
        _ => {}
    }
    if allowed.len() == 1 {
        return allowed.pop();
    }

    let peers = value.get("peers").and_then(Value::as_object);
    let peer_keys = peers
        .into_iter()
        .flat_map(|items| items.keys())
        .filter(|peer| !peer.trim().is_empty())
        .collect::<Vec<_>>();
    if peer_keys.len() == 1 {
        return Some(peer_keys[0].to_string());
    }
    None
}

fn resolve_default_dsh_peer_id() -> Option<String> {
    let path = dsh_home_dir().ok()?.join("wxbridge").join("state.json");
    let value = serde_json::from_str::<Value>(&fs::read_to_string(path).ok()?).ok()?;
    resolve_dsh_peer_id_from_state(&value)
}

async fn dsh_endpoint_is_reachable(client: &reqwest::Client, endpoint: &DshEndpoint) -> bool {
    let base = format!("http://{}:{}", endpoint.host, endpoint.port);
    for path in ["/wxbridge/health", "/api/dsh/health", "/health", "/"] {
        let Ok(response) = client.get(format!("{base}{path}")).send().await else { continue };
        let status = response.status().as_u16();
        // A 404/405 still proves the local HTTP listener is alive; the bridge
        // only needs POST /wxbridge/push below.
        if (200..=499).contains(&status) {
            return true;
        }
    }
    false
}

async fn fetch_dsh_json(client: &reqwest::Client, endpoint: &DshEndpoint, path: &str) -> Result<(u16, Value), String> {
    let url = format!("http://{}:{}{path}", endpoint.host, endpoint.port);
    let response = client.get(url).send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| error.to_string())?;
    let value = serde_json::from_str::<Value>(&body).map_err(|_| "响应不是有效 JSON".to_string())?;
    Ok((status, value))
}

fn json_count(value: Option<&Value>) -> usize {
    value.and_then(|value| value.as_u64()).unwrap_or_else(|| value.and_then(Value::as_array).map(|items| items.len() as u64).unwrap_or(0)) as usize
}

fn preflight_check(name: &str, ok: bool, detail: impl Into<String>) -> DshPreflightCheck {
    DshPreflightCheck { name: name.to_string(), ok, detail: detail.into() }
}

#[tauri::command]
async fn check_dsh_preflight(app: tauri::AppHandle) -> Result<DshPreflightResult, String> {
    let mut checks = Vec::new();
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(std::time::Duration::from_secs(1))
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| format!("无法创建 DSH 检查请求：{error}"))?;
    let candidates = dsh_endpoint_candidates("127.0.0.1", 0).unwrap_or_default();
    let mut active_endpoint: Option<DshEndpoint> = None;
    let mut status_payload = Value::Null;
    for candidate in &candidates {
        if let Ok((status, payload)) = fetch_dsh_json(&client, candidate, "/wxbridge/status").await {
            if (200..300).contains(&status) && payload.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                active_endpoint = Some(candidate.clone());
                status_payload = payload;
                break;
            }
        }
    }
    let active_port = active_endpoint.as_ref().map(|endpoint| endpoint.port);
    if let Some(endpoint) = &active_endpoint {
        let bridge = status_payload.get("bridge").unwrap_or(&status_payload);
        let phase = bridge.get("phase").and_then(Value::as_str).unwrap_or("unknown");
        let peers = json_count(status_payload.get("peers").or_else(|| bridge.get("peers")));
        let allowed = json_count(bridge.get("allowedUsers").or_else(|| status_payload.get("allowedUsers")));
        let phase_ok = ["idle", "ready", "running", "poll", "wait", "wait-credentials", "paired"].contains(&phase);
        let runtime_flags_ok = ["pidOk", "fresh", "stateOk", "runtimeBinOk"].iter().all(|key| bridge.get(*key).and_then(Value::as_bool).unwrap_or(true));
        checks.push(preflight_check("DSH bridge", phase_ok && peers > 0 && allowed > 0 && runtime_flags_ok, format!("{}:{} phase={phase}, peers={peers}, allowedUsers={allowed}", endpoint.host, endpoint.port)));
        match fetch_dsh_json(&client, endpoint, "/wxbridge/presets").await {
            Ok((status, payload)) => {
                let selected = payload.get("selected").and_then(Value::as_str).unwrap_or("");
                checks.push(preflight_check("DSH preset", status == 200 && selected == "memoflow", format!("selected={selected}, HTTP {status}")));
            }
            Err(error) => checks.push(preflight_check("DSH preset", false, error)),
        }
    } else {
        checks.push(preflight_check("DSH bridge", false, "无法访问 /wxbridge/status，请启动 DSH 微信桥"));
        checks.push(preflight_check("DSH preset", false, "未能读取当前 bridge 的 preset"));
    }

    let database = database_path(&app)?;
    let config_path = inbound_config_path(&database);
    let config = fs::read_to_string(&config_path).ok().and_then(|text| serde_json::from_str::<InboundConfig>(&text).ok());
    if let Some(config) = &config {
        let host_ok = validate_dsh_host(&config.host).is_ok();
        let inbound_url = format!("http://{}:{}{}", config.host, config.port, config.health_path);
        let health = client.get(inbound_url).header("Authorization", format!("Bearer {}", config.token)).send().await;
        match health {
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                let json_ok = serde_json::from_str::<Value>(&body).ok().and_then(|value| value.get("status").and_then(Value::as_str).map(|v| v == "ok")).unwrap_or(false);
                checks.push(preflight_check("MemoFlow 入站", host_ok && config.port > 0 && !config.token.trim().is_empty() && status == 200 && json_ok, format!("{}:{} HTTP {status}", config.host, config.port)));
            }
            Err(error) => checks.push(preflight_check("MemoFlow 入站", false, format!("{}:{} 不可达：{error}", config.host, config.port))),
        }
    } else {
        checks.push(preflight_check("MemoFlow 入站", false, format!("配置不存在或已过期：{}", config_path.display())));
    }

    let outbox = dsh_outbox_root()?;
    let sent_dir = outbox.join("sent");
    let failed_dir = outbox.join("failed");
    let dirs_ok = outbox.is_dir() && sent_dir.is_dir() && failed_dir.is_dir();
    checks.push(preflight_check("DSH 队列目录", dirs_ok, outbox.display().to_string()));
    let mcp_path = dsh_home_dir()?.join("memoflow").join("memoflow-mcp-server.mjs");
    checks.push(preflight_check("MemoFlow MCP", mcp_path.is_file(), mcp_path.display().to_string()));

    let ok = checks.iter().all(|check| check.ok);
    let message = if ok { "DSH 真实链路预检通过" } else { "DSH 真实链路预检未通过，请先修复失败项" };
    Ok(DshPreflightResult { ok, port: active_port, message: message.to_string(), checks })
}

#[cfg(test)]
mod dsh_endpoint_tests {
    use super::{parse_dsh_address_file, parse_dsh_url, resolve_dsh_peer_id_from_state};

    #[test]
    fn parses_loopback_host_address_payload_only() {
        let value = serde_json::json!({
            "host": "127.0.0.1",
            "port": 7341,
            "httpUrl": "http://127.0.0.1:7341/"
        });
        let endpoints = parse_dsh_address_file(&value);
        assert_eq!(endpoints.len(), 1);
        assert_eq!(endpoints[0].port, 7341);
        assert_eq!(parse_dsh_url("http://192.168.1.10:7341"), None);
    }

    #[test]
    fn resolves_last_paired_peer_when_state_has_no_explicit_route() {
        let state = serde_json::json!({
            "lastPeer": "peer@example",
            "peers": { "peer@example": { "history": [] } },
            "allowedUsers": "peer@example"
        });
        assert_eq!(resolve_dsh_peer_id_from_state(&state), Some("peer@example".to_string()));
    }

    #[test]
    fn resolves_single_allowed_peer_when_last_peer_is_missing() {
        let state = serde_json::json!({
            "peers": { "peer@example": { "history": [] } },
            "allowedUsers": ["peer@example"]
        });
        assert_eq!(resolve_dsh_peer_id_from_state(&state), Some("peer@example".to_string()));
    }

    #[test]
    fn does_not_guess_a_route_when_multiple_peers_are_paired() {
        let state = serde_json::json!({
            "peers": { "peer-a": {}, "peer-b": {} },
            "allowedUsers": ["peer-a", "peer-b"]
        });
        assert_eq!(resolve_dsh_peer_id_from_state(&state), None);
    }
}

fn dsh_outbox_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法确定用户目录".to_string())?;
    Ok(PathBuf::from(home).join(".dsh").join("wxbridge").join("outbox"))
}

fn safe_dsh_delivery_path(file: &str, root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(file.trim());
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let parent = path.parent().ok_or_else(|| "DSH 队列路径无效".to_string())?;
    let parent = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    if !parent.starts_with(&root) || path.file_name().and_then(|v| v.to_str()).is_none() {
        return Err("DSH 队列路径不在用户 wxbridge outbox 内".to_string());
    }
    Ok(path)
}

fn dsh_delivery_status_for_paths(file: &Path, root: &Path) -> DshDeliveryResponse {
    if file.exists() {
        return DshDeliveryResponse { status: "pending".to_string(), error: None };
    }
    let name = file.file_name().and_then(|v| v.to_str()).unwrap_or_default();
    let sent = root.join("sent").join(name);
    if sent.exists() {
        return DshDeliveryResponse { status: "sent".to_string(), error: None };
    }
    let failed = root.join("failed").join(format!("send-failed--{name}"));
    if failed.exists() {
        return DshDeliveryResponse { status: "failed".to_string(), error: Some("微信桥发送失败".to_string()) };
    }
    DshDeliveryResponse { status: "unknown".to_string(), error: Some("队列文件不存在或已被清理".to_string()) }
}

fn validate_pushplus_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        Err("PushPlus Token 不能为空".to_string())
    } else {
        Ok(())
    }
}

fn redact_pushplus_token(token: &str) -> String {
    let value = token.trim();
    if value.chars().count() <= 6 {
        return "••••••".to_string();
    }
    let prefix: String = value.chars().take(3).collect();
    let suffix: String = value
        .chars()
        .rev()
        .take(3)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("{prefix}••••{suffix}")
}

fn parse_pushplus_response(body: &str) -> Result<PushPlusResponse, String> {
    let response = serde_json::from_str::<PushPlusResponse>(body)
        .map_err(|_| "PushPlus 响应格式无效".to_string())?;
    if response.code != 200 {
        return Err(format!("PushPlus：{}", response.msg));
    }
    Ok(response)
}

#[derive(Default)]
struct CaptureState {
    nonce: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct CaptureEnvelope {
    nonce: String,
    source: String,
    rows: Vec<CaptureRow>,
    #[serde(rename = "scheduleRows", default)]
    schedule_rows: Vec<CaptureScheduleRow>,
    #[serde(default)]
    error: Option<String>,
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
    #[serde(rename = "sourceKind", default)]
    source_kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct CaptureScheduleRow {
    #[serde(rename = "externalId")]
    external_id: Option<String>,
    #[serde(rename = "courseName")]
    course_name: String,
    #[serde(rename = "courseCode")]
    course_code: Option<String>,
    weekday: u8,
    #[serde(rename = "startTime")]
    start_time: String,
    #[serde(rename = "endTime")]
    end_time: String,
    location: Option<String>,
    #[serde(rename = "sourceUrl")]
    source_url: String,
}

fn decode_capture_result(
    serialized: &str,
    expected_nonce: &str,
) -> Result<CaptureEnvelope, String> {
    if serialized.len() > MAX_CAPTURE_BYTES {
        return Err("Blackboard 返回的数据过大".to_string());
    }

    let envelope = serde_json::from_str::<CaptureEnvelope>(serialized)
        .or_else(|_| {
            serde_json::from_str::<String>(serialized)
                .map_err(|error| error.to_string())
                .and_then(|json| {
                    serde_json::from_str::<CaptureEnvelope>(&json)
                        .map_err(|error| error.to_string())
                })
        })
        .map_err(|error| format!("无法解析 Blackboard 返回结果: {error}"))?;

    if envelope.nonce != expected_nonce {
        return Err("Blackboard 返回结果的会话已失效".to_string());
    }
    if envelope.rows.len() > MAX_CAPTURE_ITEMS || envelope.schedule_rows.len() > MAX_CAPTURE_ITEMS {
        return Err("Blackboard 返回的事项数量超出限制".to_string());
    }
    if !(envelope.source == "https://bb.cuhk.edu.cn"
        || envelope.source == "https://sts.cuhk.edu.cn")
    {
        return Err("Blackboard 返回结果的来源不受信任".to_string());
    }

    Ok(envelope)
}

#[tauri::command]
fn load_snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    let database = db::SnapshotDb::open(database_path(&app)?).map_err(|error| error.to_string())?;
    Ok(database.load_snapshot().map_err(|error| error.to_string())?.unwrap_or_else(|| serde_json::json!({
        "memos": [], "reminders": [], "blackboardItems": [], "courseSchedules": [], "countdowns": [], "syncRuns": [], "externalMappings": []
    })))
}

#[tauri::command]
fn save_snapshot(app: tauri::AppHandle, snapshot: Value) -> Result<(), String> {
    let mut database =
        db::SnapshotDb::open(database_path(&app)?).map_err(|error| error.to_string())?;
    database
        .save_snapshot(&snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_schedule_archive(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path.trim());
    let is_zip = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if !is_zip {
        return Err("只能导入 ZIP 格式的课表文件".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取课表文件: {error}"))?;
    if !metadata.is_file() {
        return Err("课表路径不是文件".to_string());
    }
    if metadata.len() > MAX_SCHEDULE_ARCHIVE_BYTES {
        return Err("课表 ZIP 文件不能超过 64 MB".to_string());
    }
    fs::read(&path).map_err(|error| format!("无法读取课表文件: {error}"))
}

#[tauri::command]
async fn open_blackboard_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("blackboard") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let nonce = uuid::Uuid::new_v4().to_string();
    *state
        .nonce
        .lock()
        .map_err(|_| "无法初始化导入会话".to_string())? = Some(nonce.clone());
    let window = WebviewWindowBuilder::new(
        &app,
        "blackboard",
        WebviewUrl::External(
            BLACKBOARD_URL
                .parse::<Url>()
                .map_err(|error| error.to_string())?,
        ),
    )
    .title("Blackboard 登录")
    .inner_size(1080.0, 820.0)
    .visible(true)
    .build()
    .map_err(|error| error.to_string())?;

    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
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
        try {{
        const calendarEventSelector = '[data-calendar-item], [data-item-id], [data-due], [data-due-date], [data-event-id], [data-event], [data-start], .calendarEvent, .calendar-event, .eventItem, .fc-event, .fc-day-grid-event, .fc-time-grid-event, [class*="calendarEvent"], [class*="calendar-event"], a.event, [class~="event"], a[href*="/calendar/event/"]';
        const roots = [];
        const pendingRoots = [document];
        const seenRoots = new Set();
        while (pendingRoots.length) {{
          const root = pendingRoots.shift();
          if (!root || seenRoots.has(root)) continue;
          seenRoots.add(root);
          roots.push(root);
          for (const frame of [...(root.querySelectorAll?.('iframe') || [])]) {{
            try {{ if (frame.contentDocument) pendingRoots.push(frame.contentDocument); }} catch {{}}
          }}
        }}
        const nodes = roots.flatMap((root) => [...root.querySelectorAll(calendarEventSelector)]);
        const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const ownOrChildText = (element, selectors) => {{
          if (element.matches?.(selectors)) return cleanText(element.textContent);
          return cleanText(element.querySelector(selectors)?.textContent || '');
        }};
        const firstAttribute = (element, attributes) => {{
          for (const attribute of attributes) {{
            const value = cleanText(element.getAttribute(attribute));
            if (value) return value;
          }}
          return '';
        }};
        const firstDescendantText = (element, selectors) => cleanText(element.querySelector(selectors)?.textContent || '');
        const inferItemType = (value, fallback) => {{
          const explicit = (fallback || '').toLowerCase();
          if (/assignment|homework|作业/.test(explicit)) return 'assignment';
          if (/project|milestone|项目/.test(explicit)) return 'project';
          if (/exam|midterm|final|test|考试/.test(explicit)) return 'exam';
          const normalized = (value || '').toLowerCase();
          if (/assignment|homework|problem\s*set|作业/.test(normalized)) return 'assignment';
          if (/project|milestone|项目/.test(normalized)) return 'project';
          if (/exam|midterm|final|test|考试/.test(normalized)) return 'exam';
          return fallback || 'other';
        }};
        const eventTitle = (element) => {{
          const value = ownOrChildText(element, '.fc-event-title, .fc-title, .eventTitle, .event-title, .itemTitle, .item-title, a, h1, h2, h3, h4, strong') || cleanText(element.textContent);
          const withoutTime = value.replace(/^\d{{1,2}}:\d{{2}}\s*[ap](?:m)?\s*/i, '').trim();
          return /^\d{{1,2}}$/.test(withoutTime) ? '' : withoutTime;
        }};
        const fullCalendarEvents = (() => {{
          try {{
            const jquery = window.jQuery || window.$;
            const calendar = document.querySelector('#calendar');
            if (!jquery || !calendar || typeof jquery(calendar).fullCalendar !== 'function') return [];
            const events = jquery(calendar).fullCalendar('clientEvents');
            return Array.isArray(events) ? events : [];
          }} catch {{
            return [];
          }}
        }})();
        const eventDataFor = (title) => fullCalendarEvents.find((event) => cleanText(event?.title) === cleanText(title)) || null;
        const isAssignmentUrl = (value) => {{
          try {{
            const url = new URL(value, location.href);
            return url.hostname.toLowerCase() === 'bb.cuhk.edu.cn'
              && url.pathname.toLowerCase().includes('/webapps/assignment/uploadassignment')
              && Boolean(url.searchParams.get('content_id'))
              && Boolean(url.searchParams.get('course_id'));
          }} catch {{
            return false;
          }}
        }};
        const findAssignmentHref = (html, baseUrl, title) => {{
          try {{
            const detail = new DOMParser().parseFromString(html, 'text/html');
            const normalizedTitle = cleanText(title).toLowerCase();
            const matches = [...detail.querySelectorAll('a[href]')].map((anchor) => {{
              const href = new URL(anchor.getAttribute('href') || '', baseUrl).href;
              if (!isAssignmentUrl(href)) return null;
              const anchorText = cleanText(anchor.textContent).toLowerCase();
              const score = normalizedTitle && (anchorText === normalizedTitle || anchorText.includes(normalizedTitle)) ? 2 : 1;
              return {{ href, score }};
            }}).filter(Boolean);
            const decoded = html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\u0026/gi, '&').replace(/\\x26/gi, '&').replace(/\\\\\//g, '/');
            const pattern = /(?:https?:\/\/bb\.cuhk\.edu\.cn)?\/webapps\/assignment\/uploadAssignment\?[^\s"'<>\\]+/gi;
            for (const match of decoded.matchAll(pattern)) {{
              try {{
                const href = new URL(match[0].replace(/[),.;]+$/, ''), baseUrl).href;
                if (isAssignmentUrl(href)) matches.push({{ href, score: 1 }});
              }} catch {{}}
            }}
            return matches.sort((left, right) => right.score - left.score)[0]?.href || '';
          }} catch {{
            return '';
          }}
        }};
        const resolveEventHref = (href, title) => {{
          try {{
            if (!href) return '';
            const absolute = new URL(href, location.href).href;
            if (isAssignmentUrl(absolute) || !/\/calendar\/event\//i.test(new URL(absolute).pathname)) return absolute;
            const request = new XMLHttpRequest();
            request.open('GET', absolute, false);
            request.withCredentials = true;
            request.send();
            if (request.status >= 200 && request.status < 400) return findAssignmentHref(request.responseText, absolute, title) || absolute;
            return absolute;
          }} catch {{
            return href || '';
          }}
        }};
        const parseDateValue = (value) => {{
          const text = cleanText(value);
          if (!text) return '';
          const iso = text.match(/(20\d{{2}}[-/]\d{{1,2}}[-/]\d{{1,2}})/);
          if (iso) {{
            const parts = iso[1].split(/[-/]/).map(Number);
            if (parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && parts[2] <= 31) return iso[1].replace(/\//g, '-');
          }}
          const slash = text.match(/\b(\d{{1,2}})[-\/]([0-9]{{1,2}})[-\/](20\d{{2}})\b/);
          if (slash) return `${{slash[3]}}-${{String(slash[1]).padStart(2, '0')}}-${{String(slash[2]).padStart(2, '0')}}`;
          const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{{1,2}})(?:,\s*|\s+)(20\d{{2}})\b/i);
          if (named) {{
            const month = monthNames[named[1].toLowerCase()];
            const day = Number(named[2]);
            if (month && day >= 1 && day <= 31) return `${{named[3]}}-${{String(month).padStart(2, '0')}}-${{String(day).padStart(2, '0')}}`;
          }}
          return '';
        }};
        const monthNames = {{ january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }};
        const calendarReference = (() => {{
          const calendarText = roots.map((root) => cleanText(root.body?.innerText || root.documentElement?.textContent || '')).join(' ');
          const match = calendarText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{{2}})/i);
          return match ? {{ month: monthNames[match[1].toLowerCase()], year: Number(match[2]) }} : null;
        }})();
        const nearestDate = (element) => {{
          const owner = element.closest?.('[data-date], [data-event-date], [data-day], td[title], td, .dayGridCell, .calendarDay, .day, [role="gridcell"]')
            || element.parentElement?.closest?.('[data-date], [data-event-date], [data-day], td[title], td, .dayGridCell, .calendarDay, .day, [role="gridcell"]');
          if (!owner) return '';
          for (const attribute of ['data-date', 'data-event-date', 'data-day', 'title', 'aria-label']) {{
            const parsed = parseDateValue(owner.getAttribute(attribute));
            if (parsed) return parsed;
          }}
          const fromText = parseDateValue(owner.textContent);
          if (fromText) return fromText;
          if (!calendarReference) return '';
          const dayText = owner.querySelector?.('.dayNumber, .day-number, .date, [class*="dayNumber"], [class*="day-number"], [class*="date"]')?.textContent
            || cleanText(owner.textContent).replace(/\b\d{{1,2}}:\d{{2}}\s*[ap](?:m)?\b/gi, '');
          const dayMatch = cleanText(dayText).match(/\b([0-9]{{1,2}})\b/);
          if (!dayMatch) return '';
          const day = Number(dayMatch[1]);
          if (day < 1 || day > 31) return '';
          let month = calendarReference.month;
          let year = calendarReference.year;
          const outside = /outside|otherMonth|other-month|adjacent/i.test(owner.className || '');
          if (outside && day < 15) month += 1;
          if (outside && day > 20) month -= 1;
          if (month === 13) {{ month = 1; year += 1; }}
          if (month === 0) {{ month = 12; year -= 1; }}
          return `${{year}}-${{String(month).padStart(2, '0')}}-${{String(day).padStart(2, '0')}}`;
        }};
        const rows = nodes.map((element) => {{
          const title = eventTitle(element);
          if (!title) return null;
          const eventData = eventDataFor(title);
          const eventId = element.getAttribute('data-item-id') || element.getAttribute('data-id') || element.getAttribute('data-event-id') || element.id
            || eventData?.id
            || '';
          const calendarLaunchHref = eventData?.id && (eventData?.attemptable === true || /GradableItem/i.test(eventData?.itemSourceType || '') || /assignment/i.test(eventData?.eventType || ''))
            ? `/webapps/calendar/launch/attempt/${{encodeURIComponent(eventData.id)}}`
            : '';
          const calendarStart = eventData?.start instanceof Date
            ? eventData.start.toISOString()
            : (typeof eventData?.start === 'string' ? eventData.start : '');
          const dueNode = element.querySelector('time[datetime], [data-due], [data-due-date]');
          const dueAt = dueNode?.getAttribute('datetime')
            || dueNode?.getAttribute('data-due')
            || dueNode?.getAttribute('data-due-date')
            || element.getAttribute('data-due')
            || element.getAttribute('data-due-date')
            || element.getAttribute('data-event-date')
            || element.getAttribute('data-start')
            || element.getAttribute('datetime')
            || parseDateValue(element.getAttribute('title'))
            || parseDateValue(element.textContent)
            || nearestDate(element)
            || calendarStart
            || '';
          if (!dueAt) return null;
          const rawHref = element.getAttribute('data-assignment-url')
            || (element.matches?.('a[href]') ? element.href : (element.querySelector('a[href]')?.href || ''))
            || calendarLaunchHref;
          const href = resolveEventHref(rawHref, title);
          const sourceKind = (() => {{
            if (isAssignmentUrl(href) || /\/webapps\/calendar\/launch\/attempt\//i.test(href)) return 'assignment';
            try {{ return new URL(href, location.href).pathname.toLowerCase().includes('/calendar/event/') ? 'event' : 'unknown'; }} catch {{ return 'unknown'; }}
          }})();
          const courseName = firstAttribute(element, ['data-course-name', 'data-calendar-name', 'data-calendar-title'])
            || firstDescendantText(element, '[data-course-name], [data-calendar-name], .course-name, .course, .calendar-name')
            || cleanText(eventData?.calendarName || eventData?.calendarNameLocalizable?.rawValue || '')
            || 'Blackboard 课程';
          const itemType = inferItemType(title, firstAttribute(element, ['data-item-type'])
            || firstDescendantText(element, '[data-item-type], .item-type')
            || (/fc-event|calendar-event|eventItem/i.test(element.className || '') ? 'event' : 'other'));
          return {{
            externalId: eventId || null,
            courseName,
            courseCode: firstAttribute(element, ['data-course-code']) || firstDescendantText(element, '[data-course-code], .course-code') || null,
            title,
            itemType,
            dueAt,
            sourceUrl: href,
            sourceKind,
          }};
        }}).filter(Boolean);
        const seenRows = new Set();
        const mergedRows = rows.filter((row) => {{
          if (!row) return false;
          const key = `${{row.title}}|${{row.dueAt}}`;
          if (seenRows.has(key)) return false;
          seenRows.add(key);
          return true;
        }});
        const scheduleNodes = roots.flatMap((root) => [...root.querySelectorAll('[data-course-schedule], [data-class-event], [data-weekday], [data-day-of-week], [data-start-time]')]);
        const readValue = (element, attributes, selectors) => {{
          for (const attribute of attributes) {{ const value = element.getAttribute(attribute); if (value) return value; }}
          for (const selector of selectors) {{ const value = (element.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim(); if (value) return value; }}
          return '';
        }};
        const weekdayMap = {{ 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 7, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7 }};
        const parseWeekday = (value) => {{ const key = (value || '').trim().toLowerCase().replace(/^day\s*/, ''); return Number(key) || weekdayMap[key] || 0; }};
        const parseTime = (value) => {{ const match = (value || '').trim().match(/^(\d{{1,2}}):(\d{{2}})/); if (!match) return ''; const hour = Number(match[1]); const minute = Number(match[2]); return hour < 24 && minute < 60 ? String(hour).padStart(2, '0') + ':' + match[2] : ''; }};
        const scheduleRows = scheduleNodes.map((element) => {{
          const weekday = parseWeekday(readValue(element, ['data-weekday', 'data-day-of-week', 'data-day'], ['[data-weekday]', '[data-day-of-week]', '.weekday', '.day']));
          const startTime = parseTime(readValue(element, ['data-start-time', 'data-start'], ['[data-start-time]', 'time[data-start]']));
          const endTime = parseTime(readValue(element, ['data-end-time', 'data-end'], ['[data-end-time]', 'time[data-end]']));
          if (!weekday || !startTime || !endTime || startTime >= endTime) return null;
          const href = element.querySelector('a[href]')?.href || location.href;
          return {{
            externalId: element.getAttribute('data-item-id') || element.getAttribute('data-id') || element.id || null,
            courseName: element.getAttribute('data-course-name') || (element.querySelector('[data-course-name], .course-name, .course')?.textContent || '').replace(/\s+/g, ' ').trim() || '未命名课程',
            courseCode: element.getAttribute('data-course-code') || null,
            weekday, startTime, endTime,
            location: element.getAttribute('data-location') || (element.querySelector('[data-location], .location, .room')?.textContent || '').replace(/\s+/g, ' ').trim() || null,
            sourceUrl: href,
          }};
        }}).filter(Boolean);
        return JSON.stringify({{ nonce: '{nonce}', source: location.origin, rows: mergedRows, scheduleRows, error: null }});
        }} catch (error) {{
          return JSON.stringify({{ nonce: '{nonce}', source: location.origin, rows: [], scheduleRows: [], error: String(error) }});
        }}
      }})();
    "#
    );
    let event_app = app.clone();
    let expected_nonce = nonce.clone();
    window
        .eval_with_callback(script, move |serialized| {
            match decode_capture_result(&serialized, &expected_nonce) {
                Ok(envelope) => {
                    if let Some(error) = envelope.error {
                        let _ = event_app.emit("blackboard-capture-error", error);
                        return;
                    }
                    let payload = serde_json::json!({ "items": envelope.rows, "schedules": envelope.schedule_rows });
                    let _ = event_app.emit("blackboard-capture", payload);
                }
                Err(error) => {
                    let _ = event_app.emit("blackboard-capture-error", error);
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_blackboard_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, CaptureState>,
) -> Result<(), String> {
    *state
        .nonce
        .lock()
        .map_err(|_| "导入会话不可用".to_string())? = None;
    if let Some(window) = app.get_webview_window("blackboard") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn send_pushplus_message(message: PushPlusMessage) -> Result<PushPlusResponse, String> {
    validate_pushplus_token(&message.token)?;
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|error| format!("无法创建 PushPlus 请求：{error}"))?;
    let response = client
        .post(PUSHPLUS_ENDPOINT)
        .json(&message)
        .send()
        .await
        .map_err(|error| {
            format!(
                "PushPlus 请求失败（Token {}）：{error}",
                redact_pushplus_token(&message.token)
            )
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("无法读取 PushPlus 响应：{error}"))?;
    if !status.is_success() {
        return Err(format!("PushPlus HTTP {}", status.as_u16()));
    }
    parse_pushplus_response(&body)
}

#[tauri::command]
async fn send_dsh_wxbridge_message(message: DshWxbridgeMessage) -> Result<DshQueueResponse, String> {
    validate_dsh_host(&message.host)?;
    let text = message.text.trim();
    if text.is_empty() {
        return Err("DSH 消息不能为空".to_string());
    }
    if text.chars().count() > 4000 {
        return Err("DSH 消息不能超过 4000 个字符".to_string());
    }
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("无法创建 DSH 请求：{error}"))?;
    let mut body = serde_json::json!({ "text": text });
    let peer_id = if message.peer_id.trim().is_empty() {
        resolve_default_dsh_peer_id()
    } else {
        Some(message.peer_id.trim().to_string())
    };
    if let Some(peer_id) = peer_id {
        body["to"] = Value::String(peer_id);
    }
    let candidates = dsh_endpoint_candidates(&message.host, message.port)?;
    let mut last_error = None;
    for endpoint in &candidates {
        if !dsh_endpoint_is_reachable(&client, endpoint).await {
            last_error = Some(format!("{}:{} 无法连接", endpoint.host, endpoint.port));
            continue;
        }
        let response = match client
            .post(format!("http://{}:{}/wxbridge/push", endpoint.host, endpoint.port))
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(format!("{}:{} 请求失败：{error}", endpoint.host, endpoint.port));
                continue;
            }
        };
        let status = response.status();
        let body_text = match response.text().await {
            Ok(body_text) => body_text,
            Err(error) => {
                last_error = Some(format!("无法读取 DSH 响应：{error}"));
                continue;
            }
        };
        let parsed = match serde_json::from_str::<DshQueueResponse>(&body_text) {
            Ok(parsed) => parsed,
            Err(_) => {
                last_error = Some("DSH 响应格式无效".to_string());
                continue;
            }
        };
        if !status.is_success() || !parsed.ok {
            last_error = Some(parsed.error.unwrap_or_else(|| format!("DSH HTTP {}", status.as_u16())));
            continue;
        }
        if parsed.file.as_deref().unwrap_or_default().trim().is_empty() {
            last_error = Some("DSH 响应缺少队列文件".to_string());
            continue;
        }
        return Ok(parsed);
    }
    Err(last_error.unwrap_or_else(|| "DSH 微信桥未运行或端口不可用，请先启动 DSH 微信桥".to_string()))
}

#[tauri::command]
fn check_dsh_wxbridge_delivery(file: String) -> Result<DshDeliveryResponse, String> {
    let root = dsh_outbox_root()?;
    let safe = safe_dsh_delivery_path(&file, &root)?;
    Ok(dsh_delivery_status_for_paths(&safe, &root))
}

fn tray_menu_action(id: &str) -> &'static str {
    match id {
        "open" => "open",
        "quit" => "quit",
        _ => "ignore",
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            start_inbound_server(app.handle().clone()).map_err(std::io::Error::other)?;
            let open_item = MenuItem::with_id(app, "open", "打开 MemoFlow", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 MemoFlow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or_else(|| std::io::Error::other("MemoFlow 缺少托盘图标"))?)
                .menu(&menu)
                .tooltip("MemoFlow")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }
            // Blackboard uses a temporary child window. Only removing the
            // runtime config when the main window is destroyed prevents a
            // normal Blackboard import from disabling the still-running
            // inbound service.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(database) = database_path(&window.app_handle()) {
                    remove_inbound_config(&database);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            send_pushplus_message,
            send_dsh_wxbridge_message,
            check_dsh_wxbridge_delivery,
            check_dsh_preflight,
            load_snapshot,
            save_snapshot,
            read_schedule_archive,
            open_blackboard_window,
            capture_blackboard_calendar,
            clear_blackboard_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{create_inbound_reminder_snapshot, decode_capture_result, dsh_delivery_status_for_paths, parse_pushplus_response, safe_dsh_delivery_path, validate_dsh_host, validate_pushplus_token, validate_inbound_reminder_payload, build_inbound_config, write_inbound_config, inbound_health_payload, remove_inbound_config, tray_menu_action};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn tray_menu_routes_open_and_exit_actions() {
        assert_eq!(tray_menu_action("open"), "open");
        assert_eq!(tray_menu_action("quit"), "quit");
        assert_eq!(tray_menu_action("unknown"), "ignore");
    }

    #[test]
    fn parses_successful_pushplus_response() {
        let response =
            parse_pushplus_response(r#"{"code":200,"msg":"请求成功"}"#).expect("success");
        assert_eq!(response.code, 200);
        assert_eq!(response.msg, "请求成功");
    }

    #[test]
    fn rejects_pushplus_business_error_and_blank_token() {
        let error = parse_pushplus_response(r#"{"code":904,"msg":"token无效"}"#)
            .expect_err("business error");
        assert!(error.contains("token无效"));
        assert!(validate_pushplus_token("   ").is_err());
    }

    #[test]
    fn accepts_only_loopback_dsh_hosts() {
        assert_eq!(validate_dsh_host("127.0.0.1").expect("loopback"), "127.0.0.1");
        assert_eq!(validate_dsh_host("localhost").expect("loopback"), "localhost");
        assert!(validate_dsh_host("192.168.1.10").is_err());
    }

    #[test]
    fn classifies_dsh_delivery_files_without_reading_message_contents() {
        let root = std::env::temp_dir().join(format!("memoflow-dsh-test-{}", uuid::Uuid::new_v4()));
        let outbox = root.join("outbox");
        fs::create_dir_all(outbox.join("sent")).expect("create sent");
        fs::create_dir_all(outbox.join("failed")).expect("create failed");
        let pending = outbox.join("pending.json");
        fs::write(&pending, b"{}").expect("write pending");
        assert_eq!(dsh_delivery_status_for_paths(&pending, &outbox).status, "pending");
        fs::remove_file(&pending).expect("remove pending");
        fs::write(outbox.join("sent/pending.json"), b"{}").expect("write sent");
        assert_eq!(dsh_delivery_status_for_paths(&pending, &outbox).status, "sent");
        fs::remove_file(outbox.join("sent/pending.json")).expect("remove sent");
        fs::write(outbox.join("failed/send-failed--pending.json"), b"{}").expect("write failed");
        let failed = dsh_delivery_status_for_paths(&pending, &outbox);
        assert_eq!(failed.status, "failed");
        assert!(failed.error.is_some());
        fs::remove_file(outbox.join("failed/send-failed--pending.json")).expect("remove failed");
        let unknown = dsh_delivery_status_for_paths(&pending, &outbox);
        assert_eq!(unknown.status, "unknown");
        assert!(unknown.error.is_some());
        let rejected = safe_dsh_delivery_path(&root.join("outside.json").to_string_lossy(), &outbox);
        assert!(rejected.is_err());
        let _ = fs::remove_dir_all(PathBuf::from(root));
    }

    #[test]
    fn does_not_include_full_token_in_redacted_error() {
        let token = "secret-token-123";
        let redacted = super::redact_pushplus_token(token);
        assert!(!redacted.contains(token));
        assert!(redacted.contains("••••"));
    }

    #[test]
    fn decodes_eval_callback_payload_and_validates_nonce() {
        let payload =
            r#"{"nonce":"nonce-1","source":"https://bb.cuhk.edu.cn","rows":[],"scheduleRows":[]}"#;
        let envelope = decode_capture_result(payload, "nonce-1").expect("valid payload");
        assert_eq!(envelope.nonce, "nonce-1");
        assert!(envelope.rows.is_empty());

        let quoted_payload = serde_json::to_string(payload).expect("quoted payload");
        let quoted_envelope =
            decode_capture_result(&quoted_payload, "nonce-1").expect("quoted valid payload");
        assert_eq!(quoted_envelope.nonce, "nonce-1");
    }

    #[test]
    fn rejects_eval_callback_payload_with_wrong_nonce() {
        let payload =
            r#"{"nonce":"wrong","source":"https://bb.cuhk.edu.cn","rows":[],"scheduleRows":[]}"#;
        let error = decode_capture_result(payload, "nonce-1").expect_err("nonce must be checked");
        assert!(error.contains("会话"));
    }

    #[test]
    fn inbound_reminder_requires_exact_time_for_a_day_period() {
        let result = validate_inbound_reminder_payload(&json!({
            "title": "考试", "date": "2026-10-26", "timeOfDay": "afternoon"
        })).expect("valid structured request");
        assert_eq!(result.status, "needs_confirmation");
        assert!(result.due_at.is_none());
    }

    #[test]
    fn inbound_reminder_normalizes_exact_time_and_rejects_unknown_fields() {
        let result = validate_inbound_reminder_payload(&json!({
            "title": "考试", "date": "2026-10-26", "time": "15:00", "body": "原始描述"
        })).expect("valid structured request");
        assert_eq!(result.status, "ready");
        assert_eq!(result.due_at.as_deref(), Some("2026-10-26T15:00:00+08:00"));
        let error = validate_inbound_reminder_payload(&json!({
            "title": "考试", "date": "2026-10-26", "time": "15:00", "path": "C:\\secret"
        })).expect_err("unknown field must be rejected");
        assert!(error.contains("不支持的字段"));
    }

    #[test]
    fn inbound_reminder_writes_one_idempotent_snapshot_record() {
        let path = std::env::temp_dir().join(format!("memoflow-inbound-{}.sqlite", uuid::Uuid::new_v4()));
        let request = validate_inbound_reminder_payload(&json!({
            "title": "考试", "date": "2026-10-26", "time": "15:00", "body": "原始描述", "externalId": "dsh:test"
        })).expect("valid request");
        let first = create_inbound_reminder_snapshot(&path, &request).expect("first write");
        let second = create_inbound_reminder_snapshot(&path, &request).expect("idempotent write");
        assert_eq!(first["status"], "created");
        assert_eq!(first["id"], second["id"]);
        let database = super::db::SnapshotDb::open(&path).expect("open database");
        let snapshot = database.load_snapshot().expect("load snapshot").expect("snapshot");
        assert_eq!(snapshot["memos"].as_array().expect("memos").len(), 1);
        assert_eq!(snapshot["reminders"].as_array().expect("reminders").len(), 1);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn inbound_config_is_written_atomically_with_runtime_metadata() {
        let root = std::env::temp_dir().join(format!("memoflow-inbound-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create config directory");
        let path = root.join("dsh-inbound.json");
        let config = build_inbound_config(47321, "token-test").expect("config");
        write_inbound_config(&path, &config).expect("write config");
        let parsed: serde_json::Value = serde_json::from_slice(&fs::read(&path).expect("read config")).expect("json");
        assert_eq!(parsed["host"], "127.0.0.1");
        assert_eq!(parsed["port"], 47321);
        assert_eq!(parsed["token"], "token-test");
        assert!(parsed["pid"].as_u64().is_some());
        assert!(parsed["startedAt"].as_str().is_some());
        assert!(!path.with_extension("json.tmp").exists(), "temporary config must not remain");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_inbound_config_is_removed_when_runtime_stops() {
        let root = std::env::temp_dir().join(format!("memoflow-inbound-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create config directory");
        let database = root.join("memoflow.sqlite");
        let path = root.join("dsh-inbound.json");
        fs::write(&path, b"{\"host\":\"127.0.0.1\",\"port\":47321,\"token\":\"stale\"}").expect("write stale config");
        fs::write(path.with_extension("json.tmp"), b"partial").expect("write stale temporary config");
        remove_inbound_config(&database);
        assert!(!root.join("dsh-inbound.json").exists());
        assert!(!root.join("dsh-inbound.json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inbound_health_payload_identifies_active_runtime() {
        let payload = inbound_health_payload(47321, "started-at", 1234);
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["service"], "memoflow-inbound");
        assert_eq!(payload["port"], 47321);
        assert_eq!(payload["startedAt"], "started-at");
        assert_eq!(payload["pid"], 1234);
    }

    #[test]
    fn inbound_health_endpoint_requires_token_and_reports_live_server() {
        use std::io::{Read, Write};
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();
        let database = std::env::temp_dir().join(format!("memoflow-health-{}.sqlite", uuid::Uuid::new_v4()));
        let server_database = database.clone();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept request");
            super::handle_inbound_connection(stream, "health-token", &server_database, port, "started-at", 1234, None);
        });
        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connect health endpoint");
        client.write_all(b"GET /api/dsh/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer health-token\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").expect("write request");
        let mut response = String::new();
        client.read_to_string(&mut response).expect("read response");
        server.join().expect("join server");
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("\"service\":\"memoflow-inbound\""));
        assert!(response.contains("\"port\":"));
        let _ = fs::remove_file(database);
    }

    #[test]
    fn inbound_health_endpoint_rejects_invalid_token() {
        use std::io::{Read, Write};
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();
        let database = std::env::temp_dir().join(format!("memoflow-health-auth-{}.sqlite", uuid::Uuid::new_v4()));
        let server_database = database.clone();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept request");
            super::handle_inbound_connection(stream, "health-token", &server_database, port, "started-at", 1234, None);
        });
        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("connect health endpoint");
        client.write_all(b"GET /api/dsh/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer wrong-token\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").expect("write request");
        let mut response = String::new();
        client.read_to_string(&mut response).expect("read response");
        server.join().expect("join server");
        assert!(response.starts_with("HTTP/1.1 401 Unauthorized"));
        assert!(response.contains("本机工具令牌无效"));
        let _ = fs::remove_file(database);
    }

    #[test]
    fn injected_assignment_pattern_does_not_double_escape_regex_delimiters() {
        let source = include_str!("lib.rs");
        let pattern_line = source
            .lines()
            .find(|line| line.contains("const pattern ="))
            .expect("assignment URL pattern should be present");

        assert!(
            pattern_line.contains(r"\/webapps\/assignment\/uploadAssignment"),
            "the JavaScript regex must escape slash delimiters once: {pattern_line}"
        );
        assert!(
            !pattern_line.contains(r"\\/webapps\\/assignment\\/uploadAssignment"),
            "the JavaScript regex must not double-escape slash delimiters: {pattern_line}"
        );
    }
}
