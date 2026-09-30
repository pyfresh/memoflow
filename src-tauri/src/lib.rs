use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
mod db;

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("memoflow.sqlite"))
}

use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const BLACKBOARD_URL: &str = "https://bb.cuhk.edu.cn/";
const MAX_CAPTURE_BYTES: usize = 1_000_000;
const MAX_CAPTURE_ITEMS: usize = 5_000;
const MAX_ICAL_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
struct CaptureState {
    nonce: Mutex<Option<String>>,
}

fn validate_ical_url(raw: &str) -> Result<Url, String> {
    if raw.len() > 2048 {
        return Err("iCal 链接过长，请重新复制 Blackboard 的日历链接".to_string());
    }
    let url = Url::parse(raw.trim())
        .map_err(|_| "iCal 链接格式无效，请重新复制 Blackboard 链接".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("bb.cuhk.edu.cn") {
        return Err("只支持 bb.cuhk.edu.cn 提供的 HTTPS iCalendar 链接".to_string());
    }
    let path = url.path().to_ascii_lowercase();
    if !(path.ends_with(".ics") || path.contains("/calendarfeed/")) {
        return Err(
            "链接不是 Blackboard iCalendar Feed，请复制 Get External Calendar Link".to_string(),
        );
    }
    Ok(url)
}

#[tauri::command]
async fn fetch_blackboard_ical(url: String) -> Result<String, String> {
    let validated = validate_ical_url(&url)?;
    let raw_url = validated.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("curl.exe")
            .args([
                "--silent",
                "--show-error",
                "--fail",
                "--location",
                "--max-filesize",
                "2097152",
                "--max-time",
                "15",
                "--connect-timeout",
                "5",
                "--user-agent",
                "MemoFlow/0.1 Blackboard iCalendar import",
                raw_url.as_str(),
            ])
            .output()
            .map_err(|_| "无法启动网络请求，请确认系统支持 HTTPS 访问".to_string())?;
        if !output.status.success() {
            return Err("Blackboard 日历链接已过期或无权访问，请重新生成链接".to_string());
        }
        if output.stdout.len() > MAX_ICAL_BYTES {
            return Err("Blackboard 日历内容超过 2 MiB，未执行导入".to_string());
        }
        let content = String::from_utf8(output.stdout)
            .map_err(|_| "Blackboard 日历不是 UTF-8 文本，无法解析".to_string())?;
        if !content
            .trim_start_matches('\u{feff}')
            .lines()
            .any(|line| line.trim().eq_ignore_ascii_case("BEGIN:VCALENDAR"))
        {
            return Err(
                "返回内容不是有效的 iCalendar 日历，请重新生成 Blackboard 链接".to_string(),
            );
        }
        Ok(content)
    })
    .await
    .map_err(|_| "读取 Blackboard 日历的任务失败，请重试".to_string())?
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
        "memos": [], "reminders": [], "blackboardItems": [], "courseSchedules": [], "syncRuns": [], "externalMappings": []
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
        const nodes = [...document.querySelectorAll('[data-calendar-item], [data-item-id], [data-due], [data-due-date], [data-event-id], [data-event], [data-start], .calendarEvent, .calendar-event, .eventItem, .fc-event, .fc-day-grid-event, .fc-time-grid-event, [class*="calendarEvent"], [class*="calendar-event"]')];
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
        const parseDateValue = (value) => {{
          const text = cleanText(value);
          if (!text) return '';
          const iso = text.match(/(20\d{{2}}[-/]\d{{1,2}}[-/]\d{{1,2}})/);
          if (iso) return iso[1].replace(/\//g, '-');
          const slash = text.match(/\b(\d{{1,2}})[-\/]([0-9]{{1,2}})[-\/](20\d{{2}})\b/);
          if (slash) return `${{slash[3]}}-${{String(slash[1]).padStart(2, '0')}}-${{String(slash[2]).padStart(2, '0')}}`;
          return '';
        }};
        const monthNames = {{ january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }};
        const calendarReference = (() => {{
          const match = cleanText(document.body.innerText).match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{{2}})/i);
          return match ? {{ month: monthNames[match[1].toLowerCase()], year: Number(match[2]) }} : null;
        }})();
        const nearestDate = (element) => {{
          const owner = element.closest?.('[data-date], [data-event-date], [data-day], td[title], td, .dayGridCell, .calendarDay, .day, [class*="day"], [role="gridcell"]');
          if (!owner) return '';
          for (const attribute of ['data-date', 'data-event-date', 'data-day', 'title', 'aria-label']) {{
            const parsed = parseDateValue(owner.getAttribute(attribute));
            if (parsed) return parsed;
          }}
          const fromText = parseDateValue(owner.textContent);
          if (fromText) return fromText;
          if (!calendarReference) return '';
          const dayText = owner.querySelector?.('.dayNumber, .day-number, .date, [class*="dayNumber"], [class*="day-number"]')?.textContent || owner.textContent;
          const dayMatch = cleanText(dayText).match(/^([0-9]{{1,2}})(?:\s|$)/);
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
            || nearestDate(element)
            || '';
          const title = eventTitle(element);
          if (!dueAt || !title) return null;
          const href = element.matches?.('a[href]') ? element.href : (element.querySelector('a[href]')?.href || location.href);
          const courseName = firstAttribute(element, ['data-course-name', 'data-calendar-name', 'data-calendar-title'])
            || firstDescendantText(element, '[data-course-name], [data-calendar-name], .course-name, .course, .calendar-name')
            || 'Blackboard 课程';
          const itemType = inferItemType(title, firstAttribute(element, ['data-item-type'])
            || firstDescendantText(element, '[data-item-type], .item-type')
            || (/fc-event|calendar-event|eventItem/i.test(element.className || '') ? 'event' : 'other'));
          return {{
            externalId: element.getAttribute('data-item-id') || element.getAttribute('data-id') || element.getAttribute('data-event-id') || element.id || null,
            courseName,
            courseCode: firstAttribute(element, ['data-course-code']) || firstDescendantText(element, '[data-course-code], .course-code') || null,
            title,
            itemType,
            dueAt,
            sourceUrl: href
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
        const scheduleNodes = [...document.querySelectorAll('[data-course-schedule], [data-class-event], [data-weekday], [data-day-of-week], [data-start-time]')];
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
            clear_blackboard_session,
            fetch_blackboard_ical
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{decode_capture_result, validate_ical_url};

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
    fn validates_private_blackboard_ical_urls() {
        assert!(validate_ical_url(
            "https://bb.cuhk.edu.cn/webapps/calendar/calendarFeed/token/learn.ics"
        )
        .is_ok());
        assert!(validate_ical_url(
            "http://bb.cuhk.edu.cn/webapps/calendar/calendarFeed/token/learn.ics"
        )
        .is_err());
        assert!(validate_ical_url("https://example.com/calendar.ics").is_err());
        assert!(validate_ical_url("https://bb.cuhk.edu.cn/webapps/calendar/index").is_err());
        let long_url = format!(
            "https://bb.cuhk.edu.cn/calendarFeed/{}.ics",
            "x".repeat(2048)
        );
        assert!(validate_ical_url(&long_url).is_err());
    }
}
