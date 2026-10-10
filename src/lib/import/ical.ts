import type { ImportCandidate, ScheduleCandidate } from '../domain/types';
import { findBlackboardAssignmentUrl } from './blackboard';
import { dedupeImportCandidates, normalizeExternalItem } from './normalize';

export interface IcalParseResult {
  items: ImportCandidate[];
  schedules: ScheduleCandidate[];
  skippedCount: number;
}

interface IcalProperty {
  name: string;
  value: string;
  params: Record<string, string>;
}

const weekdayMap: Record<string, number> = { SU: 7, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const genericCalendars = new Set(['institution', 'personal', 'blackboard', 'blackboard 课程', '未命名课程']);

function decodeText(value: string): string {
  return value.replace(/\\([nNrR,;\\])/g, (_match, escaped: string) => {
    if (escaped.toLowerCase() === 'n' || escaped.toLowerCase() === 'r') return '\n';
    return escaped;
  }).trim();
}

function unfold(input: string): string[] {
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && result.length > 0) result[result.length - 1] += line.slice(1);
    else result.push(line);
  }
  return result.filter((line) => line.length > 0);
}

function parseProperty(line: string): IcalProperty | null {
  const separator = line.indexOf(':');
  if (separator < 1) return null;
  const [namePart, ...valueParts] = [line.slice(0, separator), line.slice(separator + 1)];
  const segments = namePart.split(';');
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=');
    if (equals > 0) params[segment.slice(0, equals).toUpperCase()] = decodeText(segment.slice(equals + 1));
  }
  return { name: segments[0].toUpperCase(), params, value: decodeText(valueParts.join(':')) };
}

function formatHongKong(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+08:00`;
}

function parseDate(property: IcalProperty | undefined): string | null {
  if (!property) return null;
  const value = property.value.trim();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : formatHongKong(parsed);
  }
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = match;
  if (utc) return formatHongKong(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))));
  const candidate = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const valid = new Date(`${candidate}+08:00`);
  return Number.isNaN(valid.getTime()) ? null : `${candidate}+08:00`;
}

function propertyMap(lines: string[]): Map<string, IcalProperty> {
  const properties = new Map<string, IcalProperty>();
  for (const line of lines) {
    const property = parseProperty(line);
    if (property) properties.set(property.name, property);
  }
  return properties;
}

function firstValue(properties: Map<string, IcalProperty>, names: string[]): string {
  for (const name of names) {
    const value = properties.get(name)?.value?.trim();
    if (value) return value;
  }
  return '';
}

function inferCourseName(properties: Map<string, IcalProperty>, title: string): string {
  const calendar = firstValue(properties, ['X-BB-CALENDAR-NAME', 'X-WR-CALNAME']);
  if (calendar && !genericCalendars.has(calendar.toLowerCase())) return calendar;
  const categories = firstValue(properties, ['CATEGORIES']).split(',').map((part) => part.trim()).filter(Boolean);
  const course = categories.find((part) => !genericCalendars.has(part.toLowerCase()) && !/^(assignment|homework|project|exam|test|event|personal|institution)$/i.test(part));
  if (course || calendar || categories[0]) return course || calendar || categories[0];
  const titleCourse = title.match(/^([A-Z]{2,}\s?\d{3,})\s*[-–—:]\s*(.+)$/i);
  return titleCourse ? `${titleCourse[1]} - ${titleCourse[2]}` : 'Blackboard 课程';
}

function inferCourseCode(courseName: string, properties: Map<string, IcalProperty>): string | null {
  const explicit = firstValue(properties, ['X-BB-COURSE-CODE', 'COURSE-CODE']);
  if (explicit) return explicit;
  return courseName.match(/\b([A-Z]{2,}\s?\d{3,})\b/i)?.[1] ?? null;
}

function inferItemType(properties: Map<string, IcalProperty>, title: string): string {
  const value = `${firstValue(properties, ['X-BB-ITEM-TYPE', 'CATEGORIES'])} ${title}`.toLowerCase();
  if (/assignment|homework|作业/.test(value)) return 'assignment';
  if (/project|milestone|项目/.test(value)) return 'project';
  if (/exam|midterm|final|test|考试/.test(value)) return 'exam';
  return 'event';
}

function scheduleDay(properties: Map<string, IcalProperty>, start: string): number | null {
  const byDay = firstValue(properties, ['RRULE']).match(/(?:^|;)BYDAY=([^;]+)/i)?.[1]?.split(',')[0].toUpperCase();
  if (byDay && weekdayMap[byDay]) return weekdayMap[byDay];
  const date = start.slice(0, 10).split('-').map(Number);
  if (date.length !== 3 || date.some(Number.isNaN)) return null;
  return new Date(Date.UTC(date[0], date[1] - 1, date[2])).getUTCDay() || 7;
}

function timePart(value: string): string { return value.slice(11, 16); }

function addDaysToIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weeklyEndDate(startDate: string, recurrenceRule: string): string | undefined {
  const count = recurrenceRule.match(/(?:^|;)COUNT=(\d+)(?:;|$)/i)?.[1];
  if (!count) return undefined;
  return addDaysToIsoDate(startDate, Math.max(0, Number(count) - 1) * 7);
}

export function parseIcalFeed(input: string, feedUrl: string): IcalParseResult {
  const lines = unfold(input);
  if (!lines.some((line) => /^BEGIN:VCALENDAR$/i.test(line))) throw new Error('不是有效的 iCalendar 内容');
  const items: ImportCandidate[] = [];
  const schedules: ScheduleCandidate[] = [];
  let skippedCount = 0;
  let eventLines: string[] | null = null;

  const finishEvent = (rawLines: string[]) => {
    const properties = propertyMap(rawLines);
    const uid = firstValue(properties, ['UID']);
    const title = firstValue(properties, ['SUMMARY']);
    const dueAt = parseDate(properties.get('DUE')) ?? parseDate(properties.get('DTEND')) ?? parseDate(properties.get('DTSTART'));
    if (!uid || !title || !dueAt) { skippedCount += 1; return; }
    const courseName = inferCourseName(properties, title);
    const courseCode = inferCourseCode(courseName, properties);
    const description = firstValue(properties, ['DESCRIPTION']);
    const listedUrl = firstValue(properties, ['URL']);
    const eventUrl = findBlackboardAssignmentUrl(description, listedUrl || feedUrl, title)
      || listedUrl
      || `https://bb.cuhk.edu.cn/calendar/event/${encodeURIComponent(uid)}`;
    const candidate = normalizeExternalItem({
      externalId: uid,
      courseName,
      courseCode,
      title,
      itemType: inferItemType(properties, title),
      dueAt,
      recurrenceRule: firstValue(properties, ['RRULE']),
      sourceUrl: eventUrl,
    }) as ImportCandidate;
    candidate.localMemoContent = description || undefined;
    items.push(candidate);

    const recurrence = candidate.recurrenceRule;
    const start = parseDate(properties.get('DTSTART'));
    const end = parseDate(properties.get('DTEND'));
    const lowerCourse = courseName.trim().toLowerCase();
    if (recurrence === 'FREQ=WEEKLY' && start && end && courseName && !genericCalendars.has(lowerCourse)) {
      const weekday = scheduleDay(properties, start);
      if (weekday) schedules.push({
        externalId: uid,
        courseName,
        courseCode,
        weekday,
        startTime: timePart(start),
        endTime: timePart(end),
        location: firstValue(properties, ['LOCATION']) || null,
        sourceUrl: eventUrl,
        startDate: start.slice(0, 10),
        endDate: weeklyEndDate(start.slice(0, 10), firstValue(properties, ['RRULE'])),
        recurrenceRule: recurrence,
      });
    }
  };

  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) { eventLines = []; continue; }
    if (/^END:VEVENT$/i.test(line)) { if (eventLines) finishEvent(eventLines); eventLines = null; continue; }
    if (eventLines) eventLines.push(line);
  }
  const deduped = dedupeImportCandidates(items) as ImportCandidate[];
  const seenSchedules = new Set<string>();
  const uniqueSchedules = schedules.filter((schedule) => {
    const key = schedule.externalId ?? `${schedule.courseName}|${schedule.weekday}|${schedule.startTime}`;
    if (seenSchedules.has(key)) return false;
    seenSchedules.add(key);
    return true;
  });
  return { items: deduped, schedules: uniqueSchedules, skippedCount };
}
