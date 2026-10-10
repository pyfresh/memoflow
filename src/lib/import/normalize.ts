import { parseLocalIso } from '../domain/reminders';
import type { BlackboardItem, BlackboardItemType, BlackboardSourceKind, ImportCandidate, ScheduleCandidate } from '../domain/types';
import { parseScheduleTime } from '../domain/schedule';

export interface RawBlackboardItem {
  externalId?: string | null; courseName?: string | null; courseCode?: string | null; title?: string | null;
  itemType?: string | null; dueAt?: string | null; sourceUrl?: string | null;
  sourceKind?: BlackboardSourceKind | null;
  recurrenceRule?: string | null;
}
const typeMap: Record<string, BlackboardItemType> = {
  assignment: 'assignment', homework: 'assignment', project: 'project', exam: 'exam', test: 'exam', event: 'event', activity: 'event',
};
function normalizeType(value: string | null | undefined): BlackboardItemType { return typeMap[(value ?? '').trim().toLowerCase()] ?? 'other'; }

function normalizeDueAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const local = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const candidate = `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6] ?? '00'}`;
    try { parseLocalIso(candidate); } catch { return null; }
    return `${candidate}+08:00`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+08:00`;
}
function normalizeRecurrenceRule(value: string | null | undefined): string | null {
  const rule = value?.trim().toUpperCase();
  if (!rule) return null;
  const frequency = rule.match(/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/)?.[1];
  return frequency ? `FREQ=${frequency}` : null;
}
export function normalizeCourseCode(courseName: string | null | undefined, courseCode: string | null | undefined): string | null {
  const explicit = courseCode?.trim();
  if (explicit) return explicit;
  const name = courseName?.trim() ?? '';
  const prefix = name.split(':', 1)[0]?.trim() ?? '';
  if (name.includes(':') && prefix) return prefix;
  return /^[A-Za-z]{2,}\s*\d{3,}[A-Za-z0-9-]*$/.test(name) ? name : null;
}
export function classifyBlackboardSource(value: string | null | undefined): BlackboardSourceKind {
  if (!value) return 'unknown';
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (path.includes('/webapps/assignment/uploadassignment') && url.searchParams.get('content_id') && url.searchParams.get('course_id')) return 'assignment';
    if (url.hostname.toLowerCase() === 'bb.cuhk.edu.cn' && path.includes('/calendar/event/')) return 'event';
  } catch { /* invalid sources are kept for diagnostics but never treated as assignments */ }
  return 'unknown';
}
export function normalizeExternalItem(raw: RawBlackboardItem): BlackboardItem {
  const recurrence = raw.recurrenceRule === undefined ? {} : { recurrenceRule: normalizeRecurrenceRule(raw.recurrenceRule) };
  const sourceUrl = raw.sourceUrl?.trim() || '';
  const sourceKind = raw.sourceKind ?? undefined;
  const courseName = raw.courseName?.trim() || '未命名课程';
  return { externalId: raw.externalId?.trim() || null, courseName, courseCode: normalizeCourseCode(courseName, raw.courseCode), title: raw.title?.trim() || '未命名项目', itemType: normalizeType(raw.itemType), dueAt: normalizeDueAt(raw.dueAt), sourceUrl, ...(sourceKind ? { sourceKind } : {}), ...recurrence };
}

export interface RawScheduleEntry {
  externalId?: string | null; courseName?: string | null; courseCode?: string | null;
  weekday?: string | number | null; startTime?: string | null; endTime?: string | null;
  location?: string | null; sourceUrl?: string | null;
  startDate?: string | null; endDate?: string | null; recurrenceRule?: string | null;
}

const weekdayMap: Record<string, number> = {
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  '周一': 1, '星期一': 1, '周二': 2, '星期二': 2, '周三': 3, '星期三': 3,
  '周四': 4, '星期四': 4, '周五': 5, '星期五': 5, '周六': 6, '星期六': 6, '周日': 7, '星期日': 7,
};

function normalizeWeekday(value: string | number | null | undefined): number | null {
  const key = String(value ?? '').trim().toLowerCase().replace(/^day\s*/, '');
  return weekdayMap[key] ?? null;
}

export function normalizeScheduleEntry(raw: RawScheduleEntry): ScheduleCandidate | null {
  const weekday = normalizeWeekday(raw.weekday);
  const startTime = parseScheduleTime(raw.startTime);
  const endTime = parseScheduleTime(raw.endTime);
  if (!weekday || !startTime || !endTime || startTime >= endTime) return null;
  return {
    externalId: raw.externalId?.trim() || null,
    courseName: raw.courseName?.trim() || '未命名课程',
    courseCode: raw.courseCode?.trim() || null,
    weekday,
    startTime,
    endTime,
    location: raw.location?.trim() || null,
    sourceUrl: raw.sourceUrl?.trim() || '',
    ...(raw.startDate?.trim() ? { startDate: raw.startDate.trim() } : {}),
    ...(raw.endDate?.trim() ? { endDate: raw.endDate.trim() } : {}),
    ...(raw.recurrenceRule?.trim() ? { recurrenceRule: raw.recurrenceRule.trim() } : {}),
  };
}
export function stableImportKey(item: Pick<BlackboardItem, 'externalId' | 'sourceUrl' | 'courseName' | 'courseCode' | 'title' | 'itemType'>): string | null {
  if (item.externalId?.trim()) return `id:${item.externalId.trim()}`;
  if (item.sourceUrl?.trim()) return `url:${item.sourceUrl.trim().toLowerCase()}`;
  const course = (item.courseCode || item.courseName || '').trim().toLowerCase();
  const title = (item.title || '').trim().toLowerCase();
  if (!course || !title) return null;
  return `fallback:${course}|${item.itemType}|${title}`;
}
function sameExternalItem(a: BlackboardItem, b: BlackboardItem): boolean {
  const left = stableImportKey(a); const right = stableImportKey(b); return left !== null && left === right;
}
export function classifyImportCandidate(candidate: ImportCandidate, existing: ImportCandidate[]): BlackboardItem['syncStatus'] {
  const match = existing.find((item) => sameExternalItem(candidate, item));
  if (!match) return 'new';
  return match.title === candidate.title && match.dueAt === candidate.dueAt ? 'existing' : 'updated';
}
export function dedupeImportCandidates(candidates: BlackboardItem[]): BlackboardItem[] {
  const deduped = new Map<string, BlackboardItem>();
  const noKey: BlackboardItem[] = [];
  for (const candidate of candidates) {
    const key = stableImportKey(candidate);
    if (key) deduped.set(key, candidate); else noKey.push(candidate);
  }
  return [...deduped.values(), ...noKey];
}
