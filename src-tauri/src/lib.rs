use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
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
const MAX_SCHEDULE_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const PUSHPLUS_ENDPOINT: &str = "https://www.pushplus.plus/send";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            send_pushplus_message,
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
    use super::{decode_capture_result, parse_pushplus_response, validate_pushplus_token};

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
